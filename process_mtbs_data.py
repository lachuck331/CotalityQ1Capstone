import geopandas as gpd
import pandas as pd
from pathlib import Path
import os

# Constants
# Input path for the MTBS Perimeter data (Vector Shapefile)
INPUT_MTBS_PATH = Path.home() / "teams/b13-domain-2/data/mtbs_perimeter_data/mtbs_perims_DD.shp"

# Path to the San Diego County shapefile (used as the clipping mask)
SD_COUNTY_PATH = Path("data/sd_county/sd_county.shp")

# Output directory for the processed file
OUTPUT_DIR = Path("data/mtbs_perimeter_data")
OUTPUT_FILE = OUTPUT_DIR / "sd_mtbs_perims.shp"

def filter_county(input_path: Path, sd_county: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Load the MTBS perimeter file and clip it to San Diego County.
    """
    # Read the MTBS Perimeter shapefile
    mtbs_data = gpd.read_file(input_path)
    print(f"Loaded {len(mtbs_data)} fire perimeters. CRS: {mtbs_data.crs} from {input_path}")

    # Reproject
    # To clip correctly, both datasets must be in the same Coordinate Reference System (CRS).
    if mtbs_data.crs != sd_county.crs:
        print("CRS mismatch. Reprojecting MTBS data to match SD County...")
        mtbs_data = mtbs_data.to_crs(sd_county.crs)
    else:
        print("CRS matches. No reprojection needed.")

    # Clip
    print("Clipping MTBS data to San Diego County...")
    mtbs_clipped = gpd.clip(mtbs_data, sd_county)
    
    if mtbs_clipped.empty:
        print("WARNING: The clipped dataset is empty! No fires found within the SD County boundary.")
    else:
        print(f"Clipping complete. Found {len(mtbs_clipped)} fires within San Diego County.")

    return mtbs_clipped


def filter_data(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """
    Filter the MTBS dataset to events between 2000-2024 and labeled as 'Wildfire'.
    """
    print("Filtering data by date (2000-2024) and type (Wildfire)...")
    
    # Ensure Ig_Date is datetime
    gdf['Ig_Date'] = pd.to_datetime(gdf['Ig_Date'])
    
    # Filter by year between 2000 and 2024
    date_filter = (gdf['Ig_Date'].dt.year >= 2000) & (gdf['Ig_Date'].dt.year <= 2024)
    
    # Filter by Incident Type equals 'Wildfire'
    type_filter = gdf['Incid_Type'] == 'Wildfire'
    
    # Apply both filters
    filtered_gdf = gdf[date_filter & type_filter].copy()
    
    # Convert back to python date objects
    filtered_gdf['Ig_Date'] = filtered_gdf['Ig_Date'].dt.date
    
    print(f"Filtering complete. Reduced from {len(gdf)} to {len(filtered_gdf)} records.")
    return filtered_gdf


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
    invalid_dates = gdf[~((years >= 2000) & (years <= 2024))]
    
    if not invalid_dates.empty:
        print(f"FAILED: Found {len(invalid_dates)} records outside date range 2000-2024.")
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

    # 4. Process Flow
    # Step A: Clip to County
    clipped_gdf = filter_county(INPUT_MTBS_PATH, sd_county)
    
    # Step B: Verify Spatial Overlap
    verify_county(clipped_gdf, sd_county)
    
    if clipped_gdf.empty:
        print("Stopping due to empty clipped dataset.")
        return

    # Step C: Filter Data
    filtered_gdf = filter_data(clipped_gdf)
    
    # Step D: Verify Final Output
    verify_output(filtered_gdf)
    
    # Step E: Save
    if not filtered_gdf.empty:
        print(f"Saving to {OUTPUT_FILE}...")
        filtered_gdf.to_file(OUTPUT_FILE)
        print("Done.")
    else:
        print("Final dataset is empty. Nothing to save.")


if __name__ == "__main__":
    main()
