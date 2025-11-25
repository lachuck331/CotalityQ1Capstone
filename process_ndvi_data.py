import os
from pathlib import Path
import rioxarray
import xarray as xr
import geopandas as gpd
from tqdm import tqdm
import numpy as np
from shapely.geometry import mapping
import rasterio

# Constants
INPUT_DIR = Path.home() / "teams/b13-domain-2/data/nasa_ndvi"
OUTPUT_DIR = Path("data/nasa_ndvi")
PRISM_REF_PATH = Path("data/prism_climate/ppt/sd_prism_ppt_us_30s_200201.nc")
SD_COUNTY_PATH = Path("data/sd_county/sd_county.shp")

def process_file(file_path: Path, reference_grid: xr.DataArray, sd_county: gpd.GeoDataFrame, output_dir: Path):
    """
    Process a single NDVI file: clip to SD County and regrid to match reference grid.
    """
    try:
        rds = rioxarray.open_rasterio(file_path, masked=True)
        
        # Ensure we have the right CRS for the vector before clipping
        if sd_county.crs != rds.rio.crs:
            sd_county_proj = sd_county.to_crs(rds.rio.crs)
        else:
            sd_county_proj = sd_county

        # Clip to San Diego County
        clipped = rds.rio.clip(sd_county_proj.geometry.apply(mapping), sd_county_proj.crs)

        # Reproject/Regrid to match PRISM grid
        regridded = clipped.rio.reproject_match(
            reference_grid,
            resampling=rasterio.enums.Resampling.nearest
        )
        
        # Construct output filename
        parts = file_path.name.split('_')
        doy_part = [p for p in parts if p.startswith('doy')][0]
        date_str = doy_part[3:10] 
        
        output_filename = f"sd_ndvi_800m_{date_str}.nc"
        output_path = output_dir / output_filename
        
        # Save to NetCDF
        regridded.to_netcdf(output_path)
        
    except Exception as e:
        print(f"Error processing {file_path.name}: {e}")

def verify_outputs(output_dir: Path, reference_grid: xr.DataArray):
    """
    Verify all generated files in output_dir.
    """
    print("\nVerifying outputs...")
    files = list(output_dir.glob("*.nc"))
    if not files:
        print("FAILED: No output files found.")
        return

    all_passed = True
    for file_path in files:
        try:
            ds = rioxarray.open_rasterio(file_path)
            
            # Check Shape
            if ds.shape != reference_grid.shape:
                print(f"FAILED {file_path.name}: Shape mismatch {ds.shape} != {reference_grid.shape}")
                all_passed = False
                continue

            # Check CRS
            if ds.rio.crs != reference_grid.rio.crs:
                print(f"FAILED {file_path.name}: CRS mismatch")
                all_passed = False
                continue
                
            # Check Bounds (Overlap with reference)
            r_bounds = ds.rio.bounds()
            ref_bounds = reference_grid.rio.bounds()
            
            overlap = not (r_bounds[2] < ref_bounds[0] or r_bounds[0] > ref_bounds[2] or r_bounds[3] < ref_bounds[1] or r_bounds[1] > ref_bounds[3])
            
            if not overlap:
                 print(f"FAILED {file_path.name}: Bounds do not overlap with reference")
                 all_passed = False
                 continue

        except Exception as e:
            print(f"FAILED {file_path.name}: Error opening file - {e}")
            all_passed = False
    
    if all_passed:
        print(f"SUCCESS: All {len(files)} files passed verification.")
    else:
        print("Verification finished with errors.")

def main():
    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Load reference data
    if not PRISM_REF_PATH.exists():
        print(f"Error: Reference PRISM file not found at {PRISM_REF_PATH}")
        return
    
    if not SD_COUNTY_PATH.exists():
        print(f"Error: SD County shapefile not found at {SD_COUNTY_PATH}")
        return

    print("Loading reference data...")
    prism_ref = rioxarray.open_rasterio(PRISM_REF_PATH)
    sd_county = gpd.read_file(SD_COUNTY_PATH)

    # Find input files
    input_files = list(INPUT_DIR.glob("*NDVI*.tif"))
    print(f"Found {len(input_files)} NDVI files to process.")

    total_files = len(input_files)
    max_workers = 5
    num_workers = min(max_workers, total_files)

    print("Processing files...")
    for file_path in tqdm(input_files):
        process_file(file_path, prism_ref, sd_county, OUTPUT_DIR)

    verify_outputs(OUTPUT_DIR, prism_ref)

if __name__ == "__main__":
    main()
