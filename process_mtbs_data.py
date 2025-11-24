import geopandas as gpd
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

def process_file(input_path: Path, sd_county: gpd.GeoDataFrame, output_file: Path):
    """
    Process the MTBS perimeter file: load, reproject, clip, and save.
    """
    print(f"Loading MTBS Perimeters from {input_path}...")
    # Read the MTBS Perimeter shapefile
    mtbs_data = gpd.read_file(input_path)
    print(f"Loaded {len(mtbs_data)} fire perimeters. CRS: {mtbs_data.crs}")

    # Reproject
    # To clip correctly, both datasets must be in the same Coordinate Reference System (CRS).
    if mtbs_data.crs != sd_county.crs:
        print("CRS mismatch. Reprojecting MTBS data to match SD County...")
        mtbs_data = mtbs_data.to_crs(sd_county.crs)
        print("Reprojection complete.")
    else:
        print("CRS matches. No reprojection needed.")

    # Clip
    print("Clipping MTBS data to San Diego County...")
    mtbs_clipped = gpd.clip(mtbs_data, sd_county)

    # Save Output
    if mtbs_clipped.empty:
        print("WARNING: The clipped dataset is empty! No fires found within the SD County boundary.")
    else:
        print(f"Clipping complete. Found {len(mtbs_clipped)} fires within San Diego County.")
        print(f"Saving to {output_file}...")
        mtbs_clipped.to_file(output_file)
        print("Done.")


def verify_outputs(output_path: Path, sd_county: gpd.GeoDataFrame):
    """
    Verify the generated output file.
    """
    print("\nVerifying output...")
    
    if not output_path.exists():
        print(f"FAILED: Output file not found at {output_path}")
        return

    try:
        # Load the generated file
        gdf = gpd.read_file(output_path)
        
        # Check 1: Is it empty?
        if gdf.empty:
             print("FAILED: Output shapefile is empty.")
             return

        # Check 2: CRS Match
        if gdf.crs != sd_county.crs:
            print(f"FAILED: CRS mismatch. Output: {gdf.crs}, Reference: {sd_county.crs}")
            return

        # Check 3: Bounds Check
        # Ensure the bounds of the output are within or overlapping the county
        # bounds are [minx, miny, maxx, maxy]
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
             
        print(f"SUCCESS: Verification passed. {len(gdf)} features found, CRS matches, and geometry overlaps.")

    except Exception as e:
        print(f"FAILED: Error during verification: {e}")


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

    print("Loading datasets...")
    
    # 3. Load Data
    # Read the San Diego County shapefile
    sd_county = gpd.read_file(SD_COUNTY_PATH)
    print(f"Loaded SD County boundary. CRS: {sd_county.crs}")

    # 4. Process File
    process_file(INPUT_MTBS_PATH, sd_county, OUTPUT_FILE)


    verify_outputs(OUTPUT_FILE, sd_county)


if __name__ == "__main__":
    main()
