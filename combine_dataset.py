import xarray as xr
import pandas as pd
import numpy as np
from pathlib import Path
import re
from tqdm import tqdm

# Constants
DATA_DIR = Path("data")
PRISM_DIR = DATA_DIR / "prism_climate"
MTBS_DIR = DATA_DIR / "mtbs_perimeter"
NDVI_DIR = DATA_DIR / "nasa_ndvi"
NLCD_DIR = DATA_DIR / "nlcd_annual"
DEM_DIR = DATA_DIR / "usgs_dem"
OUTPUT_FILE = DATA_DIR / "combined_data.parquet"
START_YEAR = 2000
END_YEAR = 2002

def get_prism_files(var_name):
    """
    Get list of PRISM files for a variable and extract year-month.
    Returns a list of tuples: (file_path, year, month)
    """
    files = []
    var_dir = PRISM_DIR / var_name
    if not var_dir.exists():
        print(f"Warning: Directory {var_dir} does not exist.")
        return []
    
    # Pattern: sd_prism_{var}_us_30s_YYYYMM.nc
    pattern = re.compile(rf"sd_prism_{var_name}_us_30s_(\d{{4}})(\d{{2}})\.nc$")
    
    for file_path in var_dir.glob("*.nc"):
        match = pattern.search(file_path.name)
        if match:
            year = int(match.group(1))
            if START_YEAR <= year <= END_YEAR:
                month = int(match.group(2))
                files.append((file_path, year, month))
            
    return sorted(files, key=lambda x: (x[1], x[2]))

def verify_prism(df):
    """
    Verify PRISM data.
    """
    print("Verifying PRISM data...")
    required_cols = ['ppt', 'tdmean', 'tmax', 'vpdmax']
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"Missing PRISM column: {col}")
    
    if df.isnull().any().any():
        print("Warning: NaNs found in PRISM data.")
    
    print(f"PRISM data shape: {df.shape}")
    print("PRISM verification passed.")

def load_and_process_prism():
    """
    Load PRISM data (ppt, tdmean, tmax, vpdmax).
    Returns a DataFrame indexed by (lat, lon, year, month).
    """
    print("Loading PRISM data...")
    vars = ['ppt', 'tdmean', 'tmax', 'vpdmax']
    combined_df = None
    
    for var in vars:
        print(f"Processing {var}...")
        files = get_prism_files(var)
        var_dfs = []
        
        for file_path, year, month in tqdm(files, desc=f"Loading {var}"):
            with xr.open_dataset(file_path) as ds:
                df = ds.to_dataframe().reset_index()
                
                prism_var_map = {
                    'ppt': 'Band1',
                    'tdmean': 'Band1',
                    'tmax': 'Band1',
                    'vpdmax': 'Band1'
                }
                
                target_col = prism_var_map.get(var)
                if target_col and target_col in df.columns:
                    df = df.rename(columns={target_col: var})
                else:
                    # Fallback or error if hardcoded name is missing
                    print(f"Warning: Expected column '{target_col}' not found for {var} in {file_path}. Columns: {df.columns}")
                    pass

                df['year'] = year
                df['month'] = month
                
                # Only need lat, lon, year, month, and the value
                # Standardize lat/lon names if needed (y/x -> lat/lon)
                if 'y' in df.columns and 'x' in df.columns:
                    df = df.rename(columns={'y': 'lat', 'x': 'lon'})
                
                # Round coordinates to avoid floating point mismatch
                df['lat'] = df['lat'].round(5)
                df['lon'] = df['lon'].round(5)
                
                if var in df.columns:
                    df = df[['lat', 'lon', 'year', 'month', var]]
                    var_dfs.append(df)
            
        var_combined = pd.concat(var_dfs, ignore_index=True)
        
        if combined_df is None:
            combined_df = var_combined
        else:
            # Merge on lat, lon, year, month
            combined_df = pd.merge(combined_df, var_combined, on=['lat', 'lon', 'year', 'month'], how='outer')
            
    verify_prism(combined_df)
    return combined_df

def verify_mtbs(df):
    print("Verifying MTBS data...")
    if 'burned_area' not in df.columns:
        raise ValueError("Missing MTBS column: burned_area")
    print(f"MTBS data shape: {df.shape}")
    print("MTBS verification passed.")

def load_and_process_mtbs():
    print("Loading MTBS data...")
    files = []
    # Pattern: sd_mtbs_800m_YYYYMM.nc
    pattern = re.compile(r"sd_mtbs_800m_(\d{4})(\d{2})\.nc$")
    
    for file_path in MTBS_DIR.glob("*.nc"):
        match = pattern.search(file_path.name)
        if match:
            year = int(match.group(1))
            if START_YEAR <= year <= END_YEAR:
                month = int(match.group(2))
                files.append((file_path, year, month))
            
    files.sort(key=lambda x: (x[1], x[2]))
    
    dfs = []
    for file_path, year, month in tqdm(files, desc="Loading MTBS"):
        with xr.open_dataset(file_path) as ds:
            df = ds.to_dataframe().reset_index()
            # Rename variable
            data_vars = list(ds.data_vars)
            if data_vars:
                df = df.rename(columns={data_vars[0]: 'burned_area'})
            
            df['year'] = year
            df['month'] = month
            
            if 'y' in df.columns and 'x' in df.columns:
                df = df.rename(columns={'y': 'lat', 'x': 'lon'})
            
            # Round coordinates
            df['lat'] = df['lat'].round(5)
            df['lon'] = df['lon'].round(5)
                
            if 'burned_area' in df.columns:
                df = df[['lat', 'lon', 'year', 'month', 'burned_area']]
                dfs.append(df)
                
    combined_df = pd.concat(dfs, ignore_index=True)
    verify_mtbs(combined_df)
    return combined_df

def verify_ndvi(df):
    print("Verifying NDVI data...")
    if 'ndvi' not in df.columns:
        raise ValueError("Missing NDVI column: ndvi")
    print(f"NDVI data shape: {df.shape}")
    print("NDVI verification passed.")

def load_and_process_ndvi():
    print("Loading NDVI data...")
    files = []
    # Pattern: sd_ndvi_800m_YYYY-MM-DD.nc
    pattern = re.compile(r"sd_ndvi_800m_(\d{4})-(\d{2})-(\d{2})\.nc$")
    
    for file_path in NDVI_DIR.glob("*.nc"):
        match = pattern.search(file_path.name)
        if match:
            year = int(match.group(1))
            if START_YEAR <= year <= END_YEAR:
                month = int(match.group(2))
                files.append((file_path, year, month))
            
    files.sort(key=lambda x: (x[1], x[2]))
    
    dfs = []
    for file_path, year, month in tqdm(files, desc="Loading NDVI"):
        with xr.open_dataset(file_path) as ds:
            df = ds.to_dataframe().reset_index()
            data_vars = list(ds.data_vars)
            # Filter out spatial_ref
            data_vars = [v for v in data_vars if v != 'spatial_ref']
            
            if data_vars:
                df = df.rename(columns={data_vars[0]: 'ndvi'})
            
            df['year'] = year
            df['month'] = month
            
            if 'y' in df.columns and 'x' in df.columns:
                df = df.rename(columns={'y': 'lat', 'x': 'lon'})
            
            # Round coordinates
            df['lat'] = df['lat'].round(5)
            df['lon'] = df['lon'].round(5)
            
            if 'ndvi' in df.columns:
                df = df[['lat', 'lon', 'year', 'month', 'ndvi']]
                dfs.append(df)
    
    combined_df = pd.concat(dfs, ignore_index=True)
    verify_ndvi(combined_df)
    return combined_df

def verify_nlcd(df):
    print("Verifying NLCD data...")
    if 'landcover' not in df.columns:
        raise ValueError("Missing NLCD column: landcover")
    print(f"NLCD data shape: {df.shape}")
    print("NLCD verification passed.")

def load_and_process_nlcd():
    print("Loading NLCD data...")
    files = []
    # Pattern: Annual_NLCD_LndCov_YYYY_CU_C1V1_800m.nc
    pattern = re.compile(r"Annual_NLCD_LndCov_(\d{4})_CU_C1V1_800m\.nc$")
    
    # Search recursively in subdirectories (since they are in year folders)
    for file_path in NLCD_DIR.rglob("*.nc"):
        match = pattern.search(file_path.name)
        if match:
            year = int(match.group(1))
            if START_YEAR <= year <= END_YEAR:
                files.append((file_path, year))
            
    files.sort(key=lambda x: x[1])
    
    dfs = []
    for file_path, year in tqdm(files, desc="Loading NLCD"):
        with xr.open_dataset(file_path) as ds:
            df = ds.to_dataframe().reset_index()
            data_vars = list(ds.data_vars)
            data_vars = [v for v in data_vars if v != 'spatial_ref']
            
            if data_vars:
                df = df.rename(columns={data_vars[0]: 'landcover'})
            
            df['year'] = year
            
            if 'y' in df.columns and 'x' in df.columns:
                df = df.rename(columns={'y': 'lat', 'x': 'lon'})
            
            # Round coordinates
            df['lat'] = df['lat'].round(5)
            df['lon'] = df['lon'].round(5)
            
            if 'landcover' in df.columns:
                df = df[['lat', 'lon', 'year', 'landcover']]
                dfs.append(df)
                
    combined_df = pd.concat(dfs, ignore_index=True)
    verify_nlcd(combined_df)
    return combined_df

def verify_dem(df):
    print("Verifying DEM data...")
    required = ['elevation', 'slope', 'aspect']
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Missing DEM column: {col}")
    print(f"DEM data shape: {df.shape}")
    print("DEM verification passed.")

def load_and_process_dem():
    print("Loading DEM data...")
    file_path = DEM_DIR / "usgs_dem_800m.nc"
    if not file_path.exists():
        raise FileNotFoundError(f"DEM file not found: {file_path}")
        
    with xr.open_dataset(file_path) as ds:
        df = ds.to_dataframe().reset_index()
        
        if 'y' in df.columns and 'x' in df.columns:
            df = df.rename(columns={'y': 'lat', 'x': 'lon'})
            
        # Round coordinates
        df['lat'] = df['lat'].round(5)
        df['lon'] = df['lon'].round(5)
            
        # Keep elevation, slope, aspect
        cols = ['lat', 'lon', 'elevation', 'slope', 'aspect']
        df = df[cols]
        
    verify_dem(df)
    return df

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
    # 1. Load PRISM (Base)
    prism_df = load_and_process_prism()

    print("PRISM Data:")
    print(prism_df.describe())
    
    # 2. Load MTBS
    mtbs_df = load_and_process_mtbs()

    # Merge PRISM and MTBS
    combined = pd.merge(prism_df, mtbs_df, on=['lat', 'lon', 'year', 'month'], how='left')
    del prism_df, mtbs_df
    
    # 3. Load NDVI
    ndvi_df = load_and_process_ndvi()

    # Merge NDVI
    combined = pd.merge(combined, ndvi_df, on=['lat', 'lon', 'year', 'month'], how='left')
    del ndvi_df
    
    # 4. Load NLCD
    nlcd_df = load_and_process_nlcd()

    # Merge NLCD
    # NLCD is annual, merge on lat, lon, year
    combined = pd.merge(combined, nlcd_df, on=['lat', 'lon', 'year'], how='left')
    del nlcd_df
    
    # 5. Load DEM
    dem_df = load_and_process_dem()

    # Merge DEM
    # DEM is static, merge on lat, lon
    combined = pd.merge(combined, dem_df, on=['lat', 'lon'], how='left')
    del dem_df
    
    # Verify
    verify_final_output(combined)
    
    # Save
    print(f"Saving to {OUTPUT_FILE}...")
    combined.to_parquet(OUTPUT_FILE)
    print("Done!")

if __name__ == "__main__":
    main()
