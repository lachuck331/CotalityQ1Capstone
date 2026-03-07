import os
from pathlib import Path
import rioxarray
import xarray as xr
import geopandas as gpd
from tqdm import tqdm
import numpy as np
from shapely.geometry import mapping
import rasterio
from datetime import datetime, timedelta

# Constants
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_DIR = DATA_DIR / "nasa_ndvi"
OUTPUT_DIR = DATA_DIR / "ca_nasa_ndvi"
PRISM_REF_PATH = DATA_DIR / "prism_climate" / "ppt" / "ca_prism_ppt_us_30s_200001.nc"
CA_STATE_PATH = DATA_DIR / "ca_state" / "ca_state.shp"

def process_file(file_path: Path, reference_grid: xr.DataArray, ca_state: gpd.GeoDataFrame, output_dir: Path):
    """
    Process a single NDVI file: clip to California and regrid to match reference grid.
    """
    try:
        rds = rioxarray.open_rasterio(file_path, masked=True)
        
        # Ensure we have the right CRS for the vector before clipping
        if ca_state.crs != rds.rio.crs:
            ca_state_proj = ca_state.to_crs(rds.rio.crs)
        else:
            ca_state_proj = ca_state

        # Clip to California
        clipped = rds.rio.clip(ca_state_proj.geometry.apply(mapping), ca_state_proj.crs)

        # Reproject/Regrid to match PRISM grid
        regridded = clipped.rio.reproject_match(
            reference_grid,
            resampling=rasterio.enums.Resampling.nearest
        )
        
        # Construct output filename
        # Format: MOD13A3.061__1_km_monthly_NDVI_doy2000032000000_aid0001.tif
        parts = file_path.name.split('_')
        doy_part = [p for p in parts if p.startswith('doy')][0]
        if doy_part:
            date_part = doy_part[3:10] # 2000032
            year = int(date_part[0:4])
            if year < 2000 or year > 2024:
                raise ValueError(f"Filename {file_path.name} does not match expected MODIS format.")
            doy = int(date_part[4:])
            date_obj = datetime(year, 1, 1) + timedelta(days=doy - 1)
            date_str = date_obj.strftime("%Y-%m-%d")
        else:
            raise ValueError(f"Filename {file_path.name} does not match expected MODIS format.")
        
        output_filename = f"ca_ndvi_800m_{date_str}.nc"
        output_path = output_dir / output_filename
        
        # Save to NetCDF
        regridded.to_netcdf(output_path)
        
    except Exception as e:
        print(f"Error processing {file_path.name}: {e}")

def verify_outputs(output_dir: Path, reference_grid: xr.DataArray):
    """
    Verify all generated files in output_dir.
    """
    files = list(output_dir.glob("*.nc"))
    if not files:
        print("FAILED to verify outputs: No output files found.")
        return

    all_passed = True
    for file_path in tqdm(files, desc="Verifying output files"):
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
    
    if not CA_STATE_PATH.exists():
        print(f"Error: California state shapefile not found at {CA_STATE_PATH}")
        return

    print("Loading reference data...")
    prism_ref = rioxarray.open_rasterio(PRISM_REF_PATH)
    ca_state = gpd.read_file(CA_STATE_PATH)

    # Find input files
    input_files = list(INPUT_DIR.glob("MOD13A3*NDVI*.tif"))
    print(f"Found {len(input_files)} NDVI files to process.")

    total_files = len(input_files)
    max_workers = 5
    num_workers = min(max_workers, total_files)

    print("Processing files...")
    for file_path in tqdm(input_files):
        process_file(file_path, prism_ref, ca_state, OUTPUT_DIR)

    verify_outputs(OUTPUT_DIR, prism_ref)

if __name__ == "__main__":
    main()
