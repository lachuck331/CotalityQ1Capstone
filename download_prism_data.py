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
OUTPUT_DIR = os.path.join("data", "prism_climate")
SD_SHAPEFILE_PATH = os.path.join("data", "sd_county", "sd_county.shp")

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

def verify_subset_output():
    found_files = []
    for root, dirs, files in os.walk(OUTPUT_DIR):
        for file in files:
            if file.endswith(".nc"):
                found_files.append(os.path.join(root, file))
    
    if not found_files:
        print("FAILED: No subsetted NetCDF files found.")
        return
    
    print(f"Found {len(found_files)} subsetted files.")
    
    # Check the first file
    test_file = found_files[0]
    print(f"Checking {test_file}...")
    
    try:
        rds = rioxarray.open_rasterio(test_file)
        print(f"  CRS: {rds.rio.crs}")
        print(f"  Bounds: {rds.rio.bounds()}")
        print(f"  Shape: {rds.shape}")
        
        # Load SD shapefile to compare bounds roughly
        sd_shapefile_path = os.path.join("data", "sd_county", "sd_county.shp")
        sd_county = gpd.read_file(sd_shapefile_path)
        sd_county = sd_county.to_crs(rds.rio.crs)
        sd_bounds = sd_county.total_bounds
        print(f"  SD County Bounds: {sd_bounds}")
        
        # Check if raster bounds overlap with SD bounds
        r_bounds = rds.rio.bounds()
        overlap = not (r_bounds[2] < sd_bounds[0] or r_bounds[0] > sd_bounds[2] or r_bounds[3] < sd_bounds[1] or r_bounds[1] > sd_bounds[3])
        
        if overlap:
            print("SUCCESS: Raster bounds overlap with San Diego County bounds.")
        else:
            print("FAILED: Raster bounds do not overlap with San Diego County bounds.")

    except Exception as e:
        print(f"FAILED: Error opening/checking file: {e}")

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

    verify_subset_output()

if __name__ == "__main__":
    print("Starting PRISM data download and processing...")
    main()
    print("All operations complete.")
