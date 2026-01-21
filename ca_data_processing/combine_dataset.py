import xarray as xr
import polars as pl
from pathlib import Path
import re
from tqdm import tqdm
import gc
import os

# Constants
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PRISM_DIR = DATA_DIR / "ca_prism_climate"
MTBS_DIR = DATA_DIR / "ca_mbts"
NDVI_DIR = DATA_DIR / "ca_nasa_ndvi"
NLCD_DIR = DATA_DIR / "ca_nlcd_annual"
DEM_DIR = DATA_DIR / "ca_usgs_dem"
OUTPUT_FILE = DATA_DIR / "ca_combined_data.parquet"
TEMP_DIR = DATA_DIR / "ca_temp"
START_YEAR = 2000
END_YEAR = 2024

def ensure_temp_dir():
    """Create temp directory for intermediate files."""
    TEMP_DIR.mkdir(exist_ok=True)

def cleanup_temp_dir():
    """Remove temp directory and its contents."""
    import shutil
    if TEMP_DIR.exists():
        shutil.rmtree(TEMP_DIR)

def delete_files(file_list):
    """Delete a list of files."""
    for f in file_list:
        try:
            os.remove(f)
        except OSError:
            pass

def get_prism_files(var_name):
    """Get list of PRISM files for a variable and extract year-month."""
    files = []
    var_dir = PRISM_DIR / var_name
    if not var_dir.exists():
        return []
    
    pattern = re.compile(rf"ca_prism_{var_name}_us_30s_(\d{{4}})(\d{{2}})\.nc$")
    
    for file_path in var_dir.glob("*.nc"):
        match = pattern.search(file_path.name)
        if match:
            year = int(match.group(1))
            if START_YEAR <= year <= END_YEAR:
                month = int(match.group(2))
                files.append((file_path, year, month))
            
    return sorted(files, key=lambda x: (x[1], x[2]))

def process_single_prism_file(file_path, var_name, year, month):
    """Process a single PRISM file and return a Polars DataFrame."""
    with xr.open_dataset(file_path) as ds:
        pdf = ds.to_dataframe().reset_index()
        
        if 'Band1' in pdf.columns:
            pdf = pdf.rename(columns={'Band1': var_name})
        
        if 'y' in pdf.columns and 'x' in pdf.columns:
            pdf = pdf.rename(columns={'y': 'lat', 'x': 'lon'})
        
        if var_name in pdf.columns:
            df = pl.from_pandas(pdf[['lat', 'lon', var_name]].copy())
            df = df.with_columns([
                pl.col('lat').round(5),
                pl.col('lon').round(5),
                pl.lit(year).alias('year').cast(pl.Int32),
                pl.lit(month).alias('month').cast(pl.Int32)
            ])
            return df
    return None

def process_prism_year(year, files_by_month, vars_list):
    """Process all PRISM data for a single year, return yearly parquet path."""
    monthly_parquet_files = []
    
    for month in sorted(files_by_month.keys()):
        var_files = files_by_month[month]
        
        if len(var_files) != len(vars_list):
            continue
        
        combined = None
        for var in vars_list:
            df = process_single_prism_file(var_files[var], var, year, month)
            if df is None:
                continue
                
            if combined is None:
                combined = df
            else:
                combined = combined.join(
                    df.select(['lat', 'lon', var]),
                    on=['lat', 'lon'],
                    how='left'
                )
        
        if combined is not None:
            temp_file = TEMP_DIR / f"prism_{year}_{month:02d}.parquet"
            combined.write_parquet(temp_file)
            monthly_parquet_files.append(temp_file)
            del combined
            gc.collect()
    
    if monthly_parquet_files:
        yearly_combined = pl.concat([pl.scan_parquet(f) for f in monthly_parquet_files]).collect()
        yearly_file = TEMP_DIR / f"prism_year_{year}.parquet"
        yearly_combined.write_parquet(yearly_file)
        del yearly_combined
        gc.collect()
        delete_files(monthly_parquet_files)
        return yearly_file
    return None

def process_mtbs_year(year, files_by_month):
    """Process all MTBS data for a single year, return yearly parquet path."""
    monthly_parquet_files = []
    
    for month in sorted(files_by_month.keys()):
        file_path = files_by_month[month]
        with xr.open_dataset(file_path) as ds:
            pdf = ds.to_dataframe().reset_index()
            data_vars = list(ds.data_vars)
            if data_vars:
                pdf = pdf.rename(columns={data_vars[0]: 'burned_area'})
            
            if 'y' in pdf.columns and 'x' in pdf.columns:
                pdf = pdf.rename(columns={'y': 'lat', 'x': 'lon'})
            
            if 'burned_area' in pdf.columns:
                df = pl.from_pandas(pdf[['lat', 'lon', 'burned_area']].copy())
                df = df.with_columns([
                    pl.col('lat').round(5),
                    pl.col('lon').round(5),
                    pl.lit(year).alias('year').cast(pl.Int32),
                    pl.lit(month).alias('month').cast(pl.Int32)
                ])
                temp_file = TEMP_DIR / f"mtbs_{year}_{month:02d}.parquet"
                df.write_parquet(temp_file)
                monthly_parquet_files.append(temp_file)
                del df
                gc.collect()
    
    if monthly_parquet_files:
        yearly_combined = pl.concat([pl.scan_parquet(f) for f in monthly_parquet_files]).collect()
        yearly_file = TEMP_DIR / f"mtbs_year_{year}.parquet"
        yearly_combined.write_parquet(yearly_file)
        del yearly_combined
        gc.collect()
        delete_files(monthly_parquet_files)
        return yearly_file
    return None

def process_ndvi_year(year, files_by_month):
    """Process all NDVI data for a single year, return yearly parquet path."""
    monthly_parquet_files = []
    
    for month in sorted(files_by_month.keys()):
        file_path = files_by_month[month]
        with xr.open_dataset(file_path) as ds:
            pdf = ds.to_dataframe().reset_index()
            data_vars = [v for v in ds.data_vars if v != 'spatial_ref']
            
            if data_vars:
                pdf = pdf.rename(columns={data_vars[0]: 'ndvi'})
            
            if 'y' in pdf.columns and 'x' in pdf.columns:
                pdf = pdf.rename(columns={'y': 'lat', 'x': 'lon'})
            
            if 'ndvi' in pdf.columns:
                df = pl.from_pandas(pdf[['lat', 'lon', 'ndvi']].copy())
                df = df.with_columns([
                    pl.col('lat').round(5),
                    pl.col('lon').round(5),
                    pl.lit(year).alias('year').cast(pl.Int32),
                    pl.lit(month).alias('month').cast(pl.Int32)
                ])
                temp_file = TEMP_DIR / f"ndvi_{year}_{month:02d}.parquet"
                df.write_parquet(temp_file)
                monthly_parquet_files.append(temp_file)
                del df
                gc.collect()
    
    if monthly_parquet_files:
        yearly_combined = pl.concat([pl.scan_parquet(f) for f in monthly_parquet_files]).collect()
        yearly_file = TEMP_DIR / f"ndvi_year_{year}.parquet"
        yearly_combined.write_parquet(yearly_file)
        del yearly_combined
        gc.collect()
        delete_files(monthly_parquet_files)
        return yearly_file
    return None

def process_nlcd_year(year, file_path):
    """Process NLCD data for a single year, return parquet path."""
    with xr.open_dataset(file_path) as ds:
        pdf = ds.to_dataframe().reset_index()
        data_vars = [v for v in ds.data_vars if v != 'spatial_ref']
        
        if data_vars:
            pdf = pdf.rename(columns={data_vars[0]: 'landcover'})
        
        if 'y' in pdf.columns and 'x' in pdf.columns:
            pdf = pdf.rename(columns={'y': 'lat', 'x': 'lon'})
        
        if 'landcover' in pdf.columns:
            df = pl.from_pandas(pdf[['lat', 'lon', 'landcover']].copy())
            df = df.with_columns([
                pl.col('lat').round(5),
                pl.col('lon').round(5),
                pl.lit(year).alias('year').cast(pl.Int32)
            ])
            yearly_file = TEMP_DIR / f"nlcd_year_{year}.parquet"
            df.write_parquet(yearly_file)
            del df
            gc.collect()
            return yearly_file
    return None

def load_dem():
    """Load DEM data once (static, no year dependency). Returns parquet path."""
    file_path = DEM_DIR / "usgs_dem_800m.nc"
    if not file_path.exists():
        raise FileNotFoundError(f"DEM file not found: {file_path}")
        
    with xr.open_dataset(file_path) as ds:
        pdf = ds.to_dataframe().reset_index()
        
        if 'y' in pdf.columns and 'x' in pdf.columns:
            pdf = pdf.rename(columns={'y': 'lat', 'x': 'lon'})
            
        cols = ['lat', 'lon', 'elevation', 'slope', 'aspect']
        df = pl.from_pandas(pdf[cols].copy())
        df = df.with_columns([
            pl.col('lat').round(5),
            pl.col('lon').round(5)
        ])
    
    dem_file = TEMP_DIR / "dem.parquet"
    df.write_parquet(dem_file)
    del df
    gc.collect()
    
    return dem_file

def merge_year_data(year, prism_file, mtbs_file, ndvi_file, nlcd_file, dem_file):
    """Merge all data for a single year. Returns merged parquet path."""
    # Start with PRISM as base
    combined = pl.scan_parquet(prism_file)
    
    # Join MTBS (year, month join)
    if mtbs_file:
        combined = combined.join(
            pl.scan_parquet(mtbs_file),
            on=['lat', 'lon', 'year', 'month'],
            how='left'
        )
    
    # Join NDVI (year, month join)
    if ndvi_file:
        combined = combined.join(
            pl.scan_parquet(ndvi_file),
            on=['lat', 'lon', 'year', 'month'],
            how='left'
        )
    
    # Join NLCD (year join - need to drop month from NLCD or just join on lat/lon/year)
    if nlcd_file:
        combined = combined.join(
            pl.scan_parquet(nlcd_file),
            on=['lat', 'lon', 'year'],
            how='left'
        )
    
    # Join DEM (static, lat/lon join)
    if dem_file:
        combined = combined.join(
            pl.scan_parquet(dem_file),
            on=['lat', 'lon'],
            how='left'
        )
    
    # Collect and save
    result = combined.collect()
    merged_file = TEMP_DIR / f"merged_year_{year}.parquet"
    result.write_parquet(merged_file)
    del result
    gc.collect()
    
    return merged_file

def verify_final_output(df):
    print("Verifying final combined DataFrame...")
    required_cols = ['lat', 'lon', 'year', 'month', 'ppt', 'tdmean', 'tmax', 'vpdmax', 
                     'burned_area', 'ndvi', 'landcover', 'elevation', 'slope', 'aspect']
    
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in final output: {missing}")
        
    print(f"Final DataFrame shape: {df.shape}")
    print("Final verification passed.")

def main():
    try:
        ensure_temp_dir()
        
        # Gather all file information first
        print("Gathering file information...")
        
        # PRISM files by year
        vars_list = ['ppt', 'tdmean', 'tmax', 'vpdmax']
        prism_by_year = {}
        for var in vars_list:
            for file_path, year, month in get_prism_files(var):
                if year not in prism_by_year:
                    prism_by_year[year] = {}
                if month not in prism_by_year[year]:
                    prism_by_year[year][month] = {}
                prism_by_year[year][month][var] = file_path
        
        # MTBS files by year
        mtbs_by_year = {}
        pattern = re.compile(r"ca_mbts_800m_(\d{4})(\d{2})\.nc$")
        for file_path in MTBS_DIR.glob("*.nc"):
            match = pattern.search(file_path.name)
            if match:
                year = int(match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    month = int(match.group(2))
                    if year not in mtbs_by_year:
                        mtbs_by_year[year] = {}
                    mtbs_by_year[year][month] = file_path
        
        # NDVI files by year
        ndvi_by_year = {}
        pattern = re.compile(r"ca_ndvi_800m_(\d{4})-(\d{2})-(\d{2})\.nc$")
        for file_path in NDVI_DIR.glob("*.nc"):
            match = pattern.search(file_path.name)
            if match:
                year = int(match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    month = int(match.group(2))
                    if year not in ndvi_by_year:
                        ndvi_by_year[year] = {}
                    ndvi_by_year[year][month] = file_path
        
        # NLCD files by year
        nlcd_by_year = {}
        pattern = re.compile(r"Annual_NLCD_LndCov_(\d{4})_CU_C1V1_800m\.nc$")
        for file_path in NLCD_DIR.rglob("*.nc"):
            match = pattern.search(file_path.name)
            if match:
                year = int(match.group(1))
                if START_YEAR <= year <= END_YEAR:
                    nlcd_by_year[year] = file_path
        
        # Load DEM once (static)
        print("Loading DEM data...")
        dem_file = load_dem()
        print(f"DEM loaded.")
        
        # Process each year through the entire pipeline
        all_years = sorted(set(prism_by_year.keys()))
        merged_year_files = []
        
        for year in tqdm(all_years, desc="Processing years"):
            # Process PRISM for this year
            prism_file = None
            if year in prism_by_year:
                prism_file = process_prism_year(year, prism_by_year[year], vars_list)
            
            if prism_file is None:
                continue
            
            # Process MTBS for this year
            mtbs_file = None
            if year in mtbs_by_year:
                mtbs_file = process_mtbs_year(year, mtbs_by_year[year])
            
            # Process NDVI for this year
            ndvi_file = None
            if year in ndvi_by_year:
                ndvi_file = process_ndvi_year(year, ndvi_by_year[year])
            
            # Process NLCD for this year
            nlcd_file = None
            if year in nlcd_by_year:
                nlcd_file = process_nlcd_year(year, nlcd_by_year[year])
            
            # Merge all data for this year
            merged_file = merge_year_data(year, prism_file, mtbs_file, ndvi_file, nlcd_file, dem_file)
            merged_year_files.append(merged_file)
            
            # Clean up yearly source files
            files_to_delete = [f for f in [prism_file, mtbs_file, ndvi_file, nlcd_file] if f is not None]
            delete_files(files_to_delete)
        
        # Delete DEM file
        delete_files([dem_file])
        
        # Combine all yearly merged files
        print(f"Combining {len(merged_year_files)} yearly merged files...")
        combined = pl.concat([pl.scan_parquet(f) for f in merged_year_files]).collect()
        
        # Verify
        verify_final_output(combined)
        
        # Save
        print(f"Saving to {OUTPUT_FILE}...")
        combined.write_parquet(OUTPUT_FILE)
        
        # Clean up merged year files
        delete_files(merged_year_files)
        
        print("Done!")
        
    finally:
        print("Cleaning up temporary files...")
        cleanup_temp_dir()

if __name__ == "__main__":
    main()
