import geopandas as gpd
import pandas as pd
from pathlib import Path
import os
import rioxarray
import xarray as xr
import numpy as np
import rasterio
from rasterio import features
from tqdm import tqdm

# Constants
# Input path for the MTBS Perimeter data (Vector Shapefile)
INPUT_MTBS_PATH = Path.home() / "teams/b13-domain-2/data/mtbs_perimeter_data/mtbs_perims_DD.shp"

# Path to the San Diego County shapefile (used as the clipping mask)
SD_COUNTY_PATH = Path("data/sd_county/sd_county.shp")

# Output directory for the processed file
OUTPUT_DIR = Path("data/mtbs_perimeter")
OUTPUT_FILE = OUTPUT_DIR / "sd_mtbs_perims.shp"

# Reference PRISM file for grid alignment
PRISM_REF_PATH = Path("data/prism_climate/ppt/sd_prism_ppt_us_30s_200001.nc")

# Date Range Constants
START_YEAR = 2000
END_YEAR = 2024

def filter_county(input_path: Path, sd_county: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Load the MTBS perimeter file and clip it to San Diego County.
    """
    # Read the MTBS Perimeter shapefile
    mtbs_data = gpd.read_file(input_path)
    print(f"Loaded {len(mtbs_data)} fire perimeters. CRS: {mtbs_data.crs} from {input_path}")

    # Reproject if different CRS
    if mtbs_data.crs != sd_county.crs:
        print("CRS mismatch. Reprojecting MTBS data to match SD County...")
        mtbs_data = mtbs_data.to_crs(sd_county.crs)
    else:
        print("CRS matches. No reprojection needed.")

    # Clip to SD County
    print("Clipping MTBS data to San Diego County...")
    mtbs_clipped = gpd.clip(mtbs_data, sd_county)
    
    if mtbs_clipped.empty:
        print("WARNING: The clipped dataset is empty! No fires found within the SD County boundary.")
    else:
        print(f"Clipping complete. Found {len(mtbs_clipped)} fires within San Diego County.")

    return mtbs_clipped


def filter_data(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Filter the MTBS dataset to events between START_YEAR-END_YEAR and labeled as 'Wildfire'.
    """
    print(f"Filtering data by date ({START_YEAR}-{END_YEAR}) and type (Wildfire)...")
    
    # Ensure Ig_Date is datetime
    gdf['Ig_Date'] = pd.to_datetime(gdf['Ig_Date'])
    
    # Filter by year between START_YEAR and END_YEAR
    date_filter = (gdf['Ig_Date'].dt.year >= START_YEAR) & (gdf['Ig_Date'].dt.year <= END_YEAR)
    
    # Filter by Incident Type equals 'Wildfire'
    type_filter = gdf['Incid_Type'] == 'Wildfire'
    
    # Apply both filters
    filtered_gdf = gdf[date_filter & type_filter].copy()
    
    # Convert back to python date objects
    filtered_gdf['Ig_Date'] = filtered_gdf['Ig_Date'].dt.date
    
    print(f"Filtering complete. Reduced from {len(gdf)} to {len(filtered_gdf)} records.")
    return filtered_gdf


def rasterize_data(gdf: gpd.GeoDataFrame, reference_path: Path, output_dir: Path):
    """
    Rasterize the filtered MTBS data to the 800m PRISM grid for each month.
    """
    print("\nRasterizing data to 800m grid...")
    
    if not reference_path.exists():
        print(f"ERROR: Reference grid not found at {reference_path}")
        return

    # Load reference grid to get transform and shape
    ref_grid = rioxarray.open_rasterio(reference_path)
    out_shape = ref_grid.shape[-2:] # (height, width)
    transform = ref_grid.rio.transform()
    crs = ref_grid.rio.crs
    
    # Create monthly date range
    dates = pd.date_range(start=f'{START_YEAR}-01-01', end=f'{END_YEAR}-12-31', freq='MS')
    
    print(f"Processing {len(dates)} months...")
    
    for date in tqdm(dates):
        # Define the month's range
        month_start = date.date()
        month_end = (date + pd.offsets.MonthEnd(0)).date()
        
        # Filter fires that started in this month
        monthly_fires = gdf[gdf['Ig_Date'].apply(lambda d: (d.year == date.year) and (d.month == date.month))]
        
        if not monthly_fires.empty:
            # Rasterize
            # shapes must be (geometry, value) or just geometry (if default_value used)
            shapes = [(geom, 1) for geom in monthly_fires.geometry]
            
            raster = features.rasterize(
                shapes=shapes,
                out_shape=out_shape,
                transform=transform,
                fill=0,
                default_value=1,
                dtype=np.uint8
            )
        else:
            # Create empty grid
            raster = np.zeros(out_shape, dtype=np.uint8)
            
        # Save as NetCDF
        # Create xarray DataArray
        da = xr.DataArray(
            raster[np.newaxis, :, :], # Add band dimension
            coords={
                'band': [1],
                'y': ref_grid.y,
                'x': ref_grid.x
            },
            dims=('band', 'y', 'x'),
            attrs=ref_grid.attrs
        )
        
        da.rio.write_crs(crs, inplace=True)
        da.rio.write_transform(transform, inplace=True)
        
        output_filename = f"sd_mtbs_800m_{date.strftime('%Y%m')}.nc"
        da.to_netcdf(output_dir / output_filename)
        
    print(f"Rasterization complete. Saved {len(dates)} files to {output_dir}")


def verify_rasterize(output_dir: Path, reference_path: Path):
    """
    Verify the rasterized outputs.
    """
    print("\nVerifying rasterized outputs...")
    
    if not output_dir.exists():
        print(f"FAILED: Output directory {output_dir} does not exist.")
        return
        
    files = list(output_dir.glob("*.nc"))
    if not files:
        print("FAILED: No NetCDF files found in output directory.")
        return
        
    # Load reference for comparison
    ref_grid = rioxarray.open_rasterio(reference_path)
    
    # Check all files with progress bar
    all_passed = True
    for file_path in tqdm(files, desc="Verifying files"):
        try:
            ds = rioxarray.open_rasterio(file_path)
            
            # Check Shape
            if ds.shape[-2:] != ref_grid.shape[-2:]:
                 print(f"FAILED {file_path.name}: Shape mismatch. Output: {ds.shape[-2:]}, Reference: {ref_grid.shape[-2:]}")
                 all_passed = False
                 continue

            # Check CRS
            if ds.rio.crs != ref_grid.rio.crs:
                 print(f"FAILED {file_path.name}: CRS mismatch.")
                 all_passed = False
                 continue
                 
            # Check Transform (Grid alignment)
            if ds.rio.transform() != ref_grid.rio.transform():
                 print(f"FAILED {file_path.name}: Transform mismatch (grid misalignment).")
                 all_passed = False
                 continue
                 
            # Check Values (should be 0 or 1)
            unique_vals = np.unique(ds.values)
            if not np.all(np.isin(unique_vals, [0, 1])):
                 print(f"FAILED {file_path.name}: Found unexpected values in raster: {unique_vals}. Expected only 0 and 1.")
                 all_passed = False
                 continue
                 
        except Exception as e:
            print(f"FAILED {file_path.name}: Error verifying raster: {e}")
            all_passed = False
    
    if all_passed:
        print(f"SUCCESS: Raster verification passed. All {len(files)} files match PRISM 800m grid.")
    else:
        print("Verification finished with errors.")


def verify_county(gdf: gpd.GeoDataFrame, sd_county: gpd.GeoDataFrame):
    """
    Verify the clipped data overlaps with San Diego County.
    """
    print("\nVerifying spatial overlap with SD County...")
    
    if gdf.empty:
         print("FAILED: Clipped GeoDataFrame is empty.")
         return

    # Check CRS Match
    if gdf.crs != sd_county.crs:
        print(f"FAILED: CRS mismatch. Output: {gdf.crs}, Reference: {sd_county.crs}")
        return

    # Check Bounds
    out_bounds = gdf.total_bounds
    county_bounds = sd_county.total_bounds
    
    # Check for no overlap (disjoint)
    is_disjoint = (out_bounds[0] > county_bounds[2] or  # out_minx > county_maxx
                   out_bounds[2] < county_bounds[0] or  # out_maxx < county_minx
                   out_bounds[1] > county_bounds[3] or  # out_miny > county_maxy
                   out_bounds[3] < county_bounds[1])    # out_maxy < county_miny
                   
    if is_disjoint:
         print("FAILED: Output bounds do not overlap with San Diego County.")
         return
         
    print(f"SUCCESS: Spatial verification passed. {len(gdf)} features overlap with SD County.")


def verify_output(gdf: gpd.GeoDataFrame):
    """
    Verify the final filtered output.
    """
    print("\nVerifying final output...")
    
    if gdf.empty:
        print("FAILED: Final output is empty.")
        return

    # Check Filters
    years = gdf['Ig_Date'].apply(lambda d: d.year)
    invalid_dates = gdf[~((years >= START_YEAR) & (years <= END_YEAR))]
    
    if not invalid_dates.empty:
        print(f"FAILED: Found {len(invalid_dates)} records outside date range {START_YEAR}-{END_YEAR}.")
        return

    invalid_types = gdf[gdf['Incid_Type'] != 'Wildfire']
    if not invalid_types.empty:
        print(f"FAILED: Found {len(invalid_types)} records with Incid_Type != 'Wildfire'.\n")
        return

    print(f"SUCCESS: Final verification passed. {len(gdf)} records found, all match criteria.\n")


def main():
    # 1. Setup Output Directory
    if not OUTPUT_DIR.exists():
        print(f"Creating output directory: {OUTPUT_DIR}")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 2. Verify Inputs
    if not INPUT_MTBS_PATH.exists():
        print(f"ERROR: MTBS file not found at {INPUT_MTBS_PATH}")
        return
    if not SD_COUNTY_PATH.exists():
        print(f"ERROR: SD County file not found at {SD_COUNTY_PATH}")
        return
    
    # 3. Load Data
    # Read the San Diego County shapefile
    sd_county = gpd.read_file(SD_COUNTY_PATH)
    print(f"Loaded SD County boundary. CRS: {sd_county.crs}")

    # 4. Clip to County
    clipped_gdf = filter_county(INPUT_MTBS_PATH, sd_county)
    
    # 5. Verify Spatial Overlap
    verify_county(clipped_gdf, sd_county)
    
    if clipped_gdf.empty:
        print("Stopping due to empty clipped dataset.")
        return

    # 6. Filter Data
    filtered_gdf = filter_data(clipped_gdf)
    
    # 7. Verify Final Output
    verify_output(filtered_gdf)
    
    # 8. Rasterize
    if not filtered_gdf.empty:
        rasterize_data(filtered_gdf, PRISM_REF_PATH, OUTPUT_DIR)
        
        # 9. Verify Rasterization
        verify_rasterize(OUTPUT_DIR, PRISM_REF_PATH)
        
    else:
        print("Final dataset is empty. Nothing to rasterize.")


if __name__ == "__main__":
    main()
