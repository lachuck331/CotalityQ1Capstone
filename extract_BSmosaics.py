from pathlib import Path
import zipfile
import argparse
import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio.mask import mask
from rasterio.warp import calculate_default_transform, reproject, Resampling
from shapely.geometry import mapping
from tqdm import tqdm

MOS_PATH = Path("data/MTBS_BSmosaics")
COUNTIES_PATH = Path("data/tl_2025_us_county/tl_2025_us_county.shp")

def main(args=None):
    parser = argparse.ArgumentParser(description="Extract San Diego County burn severity from MTBS mosaics")
    parser.add_argument("--output-dir", default="data", help="Output directory for Parquet files (default: data)")
    parser.add_argument("--target-crs", default="EPSG:4269", help="Target CRS for output (default: EPSG:4269)")
    parser.add_argument("--year", type=int, help="Process only a specific year (optional)")
    parser.add_argument("--verbose", action="store_true", help="Enable verbose output")
    
    parsed_args = parser.parse_args(args)
    
    # Create output directory
    output_dir = Path(parsed_args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("Loading counties...")
    try:
        counties = gpd.read_file(COUNTIES_PATH)
        counties = counties.set_crs("EPSG:4269", allow_override=True)
    except Exception as e:
        print(f"Error loading counties shapefile: {e}")
        return

    # Filter for San Diego, CA (State FP 06) to avoid ambiguity
    sd_county = counties[(counties["NAME"] == "San Diego") & (counties["STATEFP"] == "06")]
    
    if sd_county.empty:
        print("Error: San Diego County (CA) not found in the provided shapefile!")
        return
        
    print("San Diego County (CA) loaded successfully.")
    
    if not MOS_PATH.exists():
        print(f"Warning: Mosaics path {MOS_PATH} does not exist.")
        return

    years = sorted([p for p in MOS_PATH.iterdir() if p.is_dir()])
    
    # Filter to specific year if provided
    if parsed_args.year:
        years = [y for y in years if int(y.name) == parsed_args.year]
        if not years:
            print(f"No data found for year {parsed_args.year}")
            return

    all_dfs = []  # Collect all DataFrames
    processed_count = 0
    
    # Track skipped files by reason
    skipped_no_file = []
    skipped_no_overlap = []
    skipped_no_data = []
    skipped_other_error = []
    
    iterator = tqdm(years, desc="Processing years", disable=parsed_args.verbose)
    for year_dir in iterator:
        try:
            # Look for .zip files first (as per original structure)
            zips = list(year_dir.glob("*.zip"))
            if zips:
                source_path = zips[0]
            else:
                # Fallback to .tif if unzipped
                tifs = list(year_dir.glob("*.tif"))
                if tifs:
                    source_path = tifs[0]
                else:
                    if parsed_args.verbose:
                        print(f"Skipping {year_dir.name}: No .zip or .tif found")
                    skipped_no_file.append(year_dir.name)
                    continue

            df = extract_sd_burn_severity(source_path, sd_county, target_crs=parsed_args.target_crs, verbose=parsed_args.verbose)
            
            if df is not None and not df.empty:
                all_dfs.append(df)
                processed_count += 1
                if parsed_args.verbose:
                    print(f"Collected data for year {year_dir.name}: {len(df)} points")
            else:
                skipped_no_data.append(year_dir.name)
                if parsed_args.verbose:
                    print(f"Skipping {year_dir.name}: No valid data after clipping")
                
        except Exception as e:
            if "do not overlap" in str(e):
                skipped_no_overlap.append(year_dir.name)
                if parsed_args.verbose:
                    print(f"Skipping {year_dir.name}: San Diego County not in this mosaic")
            else:
                skipped_other_error.append(year_dir.name)
                print(f"Error processing {year_dir.name}: {e}")
    
    # Concatenate all DataFrames and save
    if all_dfs:
        combined_df = pd.concat(all_dfs, ignore_index=True)
        output_path = output_dir / "sd_burn_severity.parquet"
        combined_df.to_parquet(output_path, index=False)
        print(f"\n{'='*60}")
        print(f"Processing complete!")
        print(f"Processed: {processed_count} years")
        
        # Show skip statistics
        total_skipped = len(skipped_no_file) + len(skipped_no_overlap) + len(skipped_no_data) + len(skipped_other_error)
        if total_skipped > 0:
            print(f"\nSkipped: {total_skipped} years total")
            if skipped_no_overlap:
                print(f"  - No overlap with San Diego: {skipped_no_overlap}")
            if skipped_no_data:
                print(f"  - No valid data after clipping: {skipped_no_data}")
            if skipped_no_file:
                print(f"  - File not found: {skipped_no_file}")
            if skipped_other_error:
                print(f"  - Other errors: {skipped_other_error}")
        
        print(f"\nTotal points: {len(combined_df):,}")
        print(f"Output file: {output_path}")
        print(f"{'='*60}")
    else:
        total_skipped = len(skipped_no_file) + len(skipped_no_overlap) + len(skipped_no_data) + len(skipped_other_error)
        print(f"\n{'='*60}")
        print(f"No data processed - output file not created.")
        print(f"Skipped: {total_skipped} years total")
        if skipped_no_overlap:
            print(f"  - No overlap with San Diego: {skipped_no_overlap}")
        if skipped_no_data:
            print(f"  - No valid data after clipping: {skipped_no_data}")
        if skipped_no_file:
            print(f"  - File not found: {skipped_no_file}")
        if skipped_other_error:
            print(f"  - Other errors: {skipped_other_error}")
        print(f"{'='*60}")

def extract_sd_burn_severity(source_path, sd_county, target_crs="EPSG:4269", verbose=False):
    """
    Extracts SD burn severity and returns a Pandas DataFrame with x, y, severity, year.
    Optimized for ML: No geometry objects, handles nodata, returns tabular data.
    """
    
    def process_dataset(src, year_val):
        if verbose:
            print(f"Original CRS: {src.crs}")
            print(f"Original size: {src.width} x {src.height}")

        # Step 1: Clip in native CRS
        sd_reprojected = sd_county.to_crs(src.crs)
        sd_geom = [mapping(geom) for geom in sd_reprojected.geometry]
        
        try:
            # crop=True clips the raster to the bounding box of the geometry
            clipped_data, clipped_transform = mask(
                src,
                sd_geom,
                crop=True,
                nodata=src.nodata
            )
        except ValueError:
            # Shapes do not overlap
            return None

        # Step 2: Reproject to target CRS
        clipped_bounds = rasterio.transform.array_bounds(
            clipped_data.shape[1], 
            clipped_data.shape[2], 
            clipped_transform
        )
        
        dst_transform, dst_width, dst_height = calculate_default_transform(
            src.crs, 
            target_crs,
            clipped_data.shape[2],
            clipped_data.shape[1],
            *clipped_bounds
        )
        
        reprojected_data = np.zeros((clipped_data.shape[0], dst_height, dst_width), dtype=clipped_data.dtype)
        
        for band in range(clipped_data.shape[0]):
            reproject(
                source=clipped_data[band],
                destination=reprojected_data[band],
                src_transform=clipped_transform,
                src_crs=src.crs,
                dst_transform=dst_transform,
                dst_crs=target_crs,
                resampling=Resampling.nearest,
                src_nodata=src.nodata,
                dst_nodata=src.nodata # Explicitly handle nodata to avoid artifacts
            )
            
        # Step 3: Convert to Tabular Data (DataFrame)
        # Assuming single band for burn severity
        band1 = reprojected_data[0]
        
        # Create a mask for valid data (not nodata)
        if src.nodata is not None:
            valid_mask = band1 != src.nodata
        else:
            valid_mask = np.ones_like(band1, dtype=bool)
            
        rows, cols = np.where(valid_mask)
        
        if len(rows) == 0:
            return None
            
        # Get coordinates for valid pixels
        xs, ys = rasterio.transform.xy(dst_transform, rows, cols)
        severity_values = band1[rows, cols]
        
        # Create DataFrame (much more memory efficient than GeoDataFrame with Points)
        df = pd.DataFrame({
            'x': xs,
            'y': ys,
            'severity': severity_values,
            'year': int(year_val)
        })
        
        if verbose:
            print(f"Extracted {len(df)} points")
            
        return df

    source_path = Path(source_path)
    
    # Handle Zip files
    if source_path.suffix == '.zip':
        with zipfile.ZipFile(source_path, 'r') as zip_file:
            tif_names = [f for f in zip_file.namelist() if f.endswith('.tif')]
            if not tif_names:
                raise ValueError(f"No .tif found in {source_path}")
            tif_name = tif_names[0]
            
            # Extract year from filename (e.g., mtbs_CA_2000.tif)
            try:
                year = tif_name.split('_')[2].split('.')[0]
            except IndexError:
                # Fallback to parent directory name
                year = source_path.parent.name
                if not year.isdigit():
                    year = "0000"

            if verbose:
                print(f"Processing: {tif_name} (Year: {year})")

            with zip_file.open(tif_name) as tif_file:
                with rasterio.open(tif_file) as src:
                    return process_dataset(src, year)
                    
    # Handle direct TIF files
    else:
        with rasterio.open(source_path) as src:
            try:
                year = source_path.name.split('_')[2].split('.')[0]
            except IndexError:
                year = source_path.parent.name
                if not year.isdigit():
                    year = "0000"
            
            return process_dataset(src, year)

if __name__ == "__main__":
    main()