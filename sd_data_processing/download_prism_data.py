from concurrent.futures import ThreadPoolExecutor, as_completed
import os
import urllib.request
import urllib.error
import zipfile
import time
from tqdm import tqdm
import geopandas as gpd
import rioxarray
import xarray as xr
from shapely.geometry import mapping
import shutil

# Base URL for PRISM data
BASE_URL = "https://services.nacse.org/prism/data/get/us/800m"

# Data types to download
DATA_TYPES = ["tmax", "tdmean", "vpdmax", "ppt"]

# Output directory
# Output directory
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUTPUT_DIR = os.path.join(DATA_DIR, "prism_climate")
SD_SHAPEFILE_PATH = os.path.join(DATA_DIR, "sd_county", "sd_county.shp")

START_YEAR = 2000
END_YEAR = 2024

def download_and_process_prism_data(start_year, end_year, sd_county, worker_id=0):
    """
    Downloads PRISM climate data for years 1999-2024 and months 1-12.
    Subsets the data to San Diego County immediately after download.
    """
    # Calculate total downloads
    total_years = end_year - start_year + 1
    total_months = 12
    total_downloads = total_years * total_months * len(DATA_TYPES)

    # Loop through years and months with progress bar
    desc = f"Worker {worker_id} ({start_year}-{end_year})"
    with tqdm(total=total_downloads, desc=desc, position=worker_id) as pbar:
        for year in range(start_year, end_year + 1):
            for month in range(1, 13):
                # Format date string as YYYYMM
                date_str = f"{year}{month:02d}"
                
                for dtype in DATA_TYPES:
                    # Construct URL
                    url = f"{BASE_URL}/{dtype}/{date_str}?format=nc"
                    
                    # Construct filename
                    filename = f"prism_{dtype}_us_30s_{date_str}.zip"
                    filepath = os.path.join(OUTPUT_DIR, filename)
                    
                    # Target subset file path
                    output_filename = f"sd_prism_{dtype}_us_30s_{date_str}.nc"
                    output_path = os.path.join(OUTPUT_DIR, dtype, output_filename)

                    try:
                        # Check if subset file already exists to skip download
                        if os.path.exists(output_path):
                             pbar.update(1)
                             continue

                        # Download the file
                        urllib.request.urlretrieve(url, filepath)
                        
                        # Extract
                        extract_path = os.path.join(OUTPUT_DIR, f"{dtype}", date_str)
                        if not os.path.exists(extract_path):
                            os.makedirs(extract_path)
                        
                        try:
                            with zipfile.ZipFile(filepath, 'r') as z:
                                z.extractall(extract_path)
                        except zipfile.BadZipFile:
                            print(f"  Error: Downloaded content for {dtype} {date_str} is not a valid zip file.")
                            if os.path.exists(filepath):
                                with open(filepath, 'rb') as f:
                                    print(f"  Content preview: {f.read(200)}")
                                os.remove(filepath)
                            pbar.update(1)
                            continue
                        
                        # Remove the zip file
                        if os.path.exists(filepath):
                            os.remove(filepath)
                        
                        # Process (Subset) immediately
                        # Find the .nc file
                        nc_file = None
                        for f in os.listdir(extract_path):
                            if f.endswith(".nc"):
                                nc_file = os.path.join(extract_path, f)
                                break
                        
                        if nc_file:
                            rds = None
                            try:
                                # Open raster
                                rds = rioxarray.open_rasterio(nc_file)
                                
                                # Ensure CRS matches (sd_county is passed in, assume it's correct or check once)
                                # Note: Checking CRS every time might be slow, but safe. 
                                # Ideally sd_county is already in a compatible CRS or we project the raster.
                                # PRISM is usually NAD83.
                                
                                if rds.rio.crs != sd_county.crs:
                                    # It's better to project the vector to the raster CRS to avoid warping the raster grid
                                    sd_county_proj = sd_county.to_crs(rds.rio.crs)
                                else:
                                    sd_county_proj = sd_county

                                # Clip
                                clipped = rds.rio.clip(sd_county_proj.geometry.apply(mapping), sd_county_proj.crs)
                                
                                # Save subset
                                clipped.to_netcdf(output_path)
                                
                            except Exception as e:
                                print(f"  Error processing {nc_file}: {e}")
                            finally:
                                if rds is not None:
                                    rds.close()
                        
                        # Cleanup extracted folder to save space
                        # Retry mechanism for rmtree to handle transient file locks or filesystem lag
                        for attempt in range(5):
                            try:
                                if os.path.exists(extract_path):
                                    shutil.rmtree(extract_path)
                                break
                            except OSError as e:
                                if attempt == 4:
                                    print(f"  Warning: Failed to remove {extract_path} after retries: {e}")
                                else:
                                    time.sleep(0.5)
                        
                        # Add a small delay
                        time.sleep(0.1)
                        
                    except urllib.error.URLError as e:
                        print(f"  Error downloading {url}: {e}")
                    except Exception as e:
                        print(f"  An unexpected error occurred: {e}")
                        if os.path.exists(filepath):
                            os.remove(filepath)
                    
                    pbar.update(1)

def verify_prism_output():
    found_files = []

    DELETE_EXTENSIONS = ['.zip', '.xml', '.tif', '.aux.xml']
    delete_count = 0

    for root, dirs, files in os.walk(OUTPUT_DIR):
        for file in files:
            full_path = os.path.join(root, file)
            if file.endswith(".nc"):
                found_files.append(full_path)
            elif any(file.endswith(ext) for ext in DELETE_EXTENSIONS):
                os.remove(full_path)
                delete_count += 1

    if not found_files:
        print("FAILED: No subsetted NetCDF files found.")
        return
    
    print(f"Found {len(found_files)} subsetted files.")
    print(f"Deleted {delete_count} files.")
    
    # Load SD shapefile once for comparison
    sd_shapefile_path = os.path.join("data", "sd_county", "sd_county.shp")
    try:
        sd_county = gpd.read_file(sd_shapefile_path)
    except Exception as e:
        print(f"FAILED: Could not load SD shapefile: {e}")
        return

    passed_count = 0
    failed_count = 0
    
    print("Verifying all files...")
    for file_path in tqdm(found_files):
        try:
            rds = rioxarray.open_rasterio(file_path)
            
            # Ensure CRS matches (or project SD to raster CRS)
            # We'll project SD to raster CRS for the check
            if rds.rio.crs != sd_county.crs:
                 sd_county_proj = sd_county.to_crs(rds.rio.crs)
            else:
                 sd_county_proj = sd_county
            
            sd_bounds = sd_county_proj.total_bounds
            r_bounds = rds.rio.bounds()
            
            # Check overlap
            overlap = not (r_bounds[2] < sd_bounds[0] or r_bounds[0] > sd_bounds[2] or r_bounds[3] < sd_bounds[1] or r_bounds[1] > sd_bounds[3])
            
            if overlap:
                passed_count += 1
            else:
                print(f"FAILED: {os.path.basename(file_path)} does not overlap with San Diego County.")
                failed_count += 1
                
            rds.close()

        except Exception as e:
            print(f"FAILED: Error checking {os.path.basename(file_path)}: {e}")
            failed_count += 1

    print(f"\nVerification Complete.")
    print(f"Passed: {passed_count}")
    print(f"Failed: {failed_count}")

def main():
    # Determine number of workers
    total_years = END_YEAR - START_YEAR + 1
    max_workers = 5 # Set a reasonable maximum
    num_workers = min(max_workers, total_years)
    
    print(f"Starting download and processing with {num_workers} workers...")

    # Create main directory
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
        print(f"Created directory: {OUTPUT_DIR}")

    # Create subset directory structure if it doesn't exist (thread-safe enough for mkdirs)
    for dtype in DATA_TYPES:
        os.makedirs(os.path.join(OUTPUT_DIR, dtype), exist_ok=True)

    # Load San Diego shapefile ONCE
    if not os.path.exists(SD_SHAPEFILE_PATH):
        print(f"Error: San Diego shapefile not found at {SD_SHAPEFILE_PATH}")
        return
    
    print("Loading San Diego shapefile...")
    sd_county = gpd.read_file(SD_SHAPEFILE_PATH)

    # Calculate years per worker
    years_per_worker = total_years // num_workers
    remainder = total_years % num_workers

    futures = []
    current_start_year = START_YEAR

    with ThreadPoolExecutor(max_workers=num_workers) as executor:
        for i in range(num_workers):
            # Distribute remainder years to the first few workers
            count = years_per_worker + (1 if i < remainder else 0)
            current_end_year = current_start_year + count - 1
            
            # Submit task - Pass sd_county
            futures.append(executor.submit(download_and_process_prism_data, current_start_year, current_end_year, sd_county, i))
            
            current_start_year = current_end_year + 1

        # Wait for all tasks to complete
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"Worker failed with error: {e}")

    verify_prism_output()

if __name__ == "__main__":
    print("Starting PRISM data download and processing...")
    main()
    print("All operations complete.")
