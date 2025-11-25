from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional
import urllib.request
import zipfile
from tqdm import tqdm
import geopandas as gpd
import rioxarray as rxr
import xarray as xr
import numpy as np
from scipy import stats
import shutil

BASE_URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles"
START_YEAR = 2000
END_YEAR = 2024
OUTPUT_DIR = Path("data/nlcd_annual")
SD_COUNTY = Path("data/sd_county/sd_county.shp")
PRISM_PATH = Path("data/prism_climate/ppt/sd_prism_ppt_us_30s_200201.nc")

# Excluded NLCD classes
EXCLUDED_CLASSES = [11, 12, 250]  # Open Water, Perennial Snow, No Data

class DownloadProgressBar(tqdm):
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)

def download_zip_for_year(year: int, output_dir: Path) -> Path:
    filename = f"Annual_NLCD_LndCov_{year}_CU_C1V1.zip"
    url = f"{BASE_URL}/{filename}"
    output_dir = output_dir / str(year)
    output_dir.mkdir(parents=True, exist_ok=True)
    zip_path = output_dir / filename

    with DownloadProgressBar(unit='B', unit_scale=True, miniters=1, desc="Downloading " + filename.split('/')[-1]) as dpb:
        urllib.request.urlretrieve(url, zip_path, reporthook=dpb.update_to)
    return zip_path

def extract_zip(zip_path: Path, destination: Path) -> None:
    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        zip_ref.extractall(destination)
    zip_path.unlink()

def clip_to_sd_county(nlcd_path: Path, sd_county: gpd.GeoDataFrame) -> Path:
    nlcd = rxr.open_rasterio(nlcd_path, masked=True)
    sd_county_nlcd_crs = sd_county.to_crs(nlcd.rio.crs)
    nlcd_clipped = nlcd.rio.clip_box(
        minx=sd_county_nlcd_crs.total_bounds[0] - 10000,
        miny=sd_county_nlcd_crs.total_bounds[1] - 10000,
        maxx=sd_county_nlcd_crs.total_bounds[2] + 10000,
        maxy=sd_county_nlcd_crs.total_bounds[3] + 10000
    )
    nlcd_geo = nlcd_clipped.rio.reproject("EPSG:4326")
    return nlcd_geo

def mode_statistic(values):
    """Calculate mode (most common value) for binned_statistic_2d."""
    if len(values) == 0:
        return np.nan
    # Filter out excluded classes before calculating mode
    filtered = values[~np.isin(values, EXCLUDED_CLASSES)]
    if len(filtered) == 0:
        return np.nan
    mode_result = stats.mode(filtered, keepdims=False)
    return mode_result.mode

def upscale_to_prism(nlcd_geo, prism, output_path):
    # Extract NLCD coordinates (fine grid)
    lon_nlcd = nlcd_geo.coords['x'].values
    lat_nlcd = nlcd_geo.coords['y'].values

    # Extract PRISM coordinates (coarse grid)
    lon_prism = prism.coords['x'].values
    lat_prism = prism.coords['y'].values
    
    # Create 2D meshgrid and flatten
    lon_nlcd_2d, lat_nlcd_2d = np.meshgrid(lon_nlcd, lat_nlcd)
    lon_nlcd_flat = lon_nlcd_2d.flatten()
    lat_nlcd_flat = lat_nlcd_2d.flatten()
    
    # Flatten NLCD data
    nlcd_data = np.squeeze(nlcd_geo.data)
    nlcd_flat = nlcd_data.flatten()
    
    # Remove NaN values to speed up processing
    valid_mask = ~np.isnan(nlcd_flat)
    lon_nlcd_flat = lon_nlcd_flat[valid_mask]
    lat_nlcd_flat = lat_nlcd_flat[valid_mask]
    nlcd_flat = nlcd_flat[valid_mask]

    # Create bin edges using np.arange
    lon_step = abs(lon_prism[1] - lon_prism[0])
    lat_step = abs(lat_prism[1] - lat_prism[0])
    lon_bins = np.arange(lon_prism.min(), lon_prism.max() + lon_step, lon_step)
    lat_bins = np.arange(lat_prism.min(), lat_prism.max() + lat_step, lat_step)

    # Use binned_statistic_2d to aggregate
    nlcd_coarse = stats.binned_statistic_2d(
        lon_nlcd_flat,
        lat_nlcd_flat,
        nlcd_flat,
        statistic=mode_statistic,
        bins=[lon_bins, lat_bins]
    ).statistic.T

    nlcd_output = xr.DataArray(
        nlcd_coarse[np.newaxis, :, :],  # Add band dimension
        coords={
            'band': [1],
            'y': lat_prism,
            'x': lon_prism
        },
        dims=['band', 'y', 'x']
    )

    # Set CRS
    nlcd_output = nlcd_output.rio.write_crs(prism.rio.crs)

    nlcd_output.to_netcdf(output_path)
    return nlcd_output

def download_and_extract_year(year: int, output_dir: Path, sd_county: gpd.GeoDataFrame, prism: xr.DataArray) -> xr.DataArray:
    zip_path = download_zip_for_year(year, output_dir)
    extract_zip(zip_path, zip_path.parent)
    
    # Clip to SD County
    nlcd_path = zip_path.parent / f"Annual_NLCD_LndCov_{year}_CU_C1V1.tif"
    nlcd_geo = clip_to_sd_county(nlcd_path, sd_county)
    
    # Upscale to PRISM grid
    output_filename = f"Annual_NLCD_LndCov_{year}_CU_C1V1_800m.nc"
    output_path = zip_path.parent / output_filename
    nlcd_output = upscale_to_prism(nlcd_geo, prism, output_path)
    
    # Cleanup: remove original TIFF and XML files to save space
    for file in zip_path.parent.glob("*.tif"):
        file.unlink()
    for file in zip_path.parent.glob("*.xml"):
        file.unlink()
    
    return nlcd_output

def verify_nlcd_output(nlcd_outputs: list[xr.DataArray], prism: xr.DataArray, sd_county: gpd.GeoDataFrame) -> None:
    """Verify all processed NLCD outputs match PRISM grid and overlap with SD County."""
    print("\n" + "=" * 60)
    print("NLCD Verification")
    print("=" * 60)
    
    all_passed = True
    
    print(f"\nFound {len(nlcd_outputs)} processed NLCD file(s).")
    
    for i, nlcd in enumerate(tqdm(nlcd_outputs, desc="Verifying NLCD outputs"), 1):
        # print(f"\n[{i}/{len(nlcd_outputs)}] Verifying {nlcd.name or 'file ' + str(i)}...")
        
        try:            
            # Check shape match
            if nlcd.shape != prism.shape:
                print(f"  ✗ Shape mismatch: {nlcd.shape} != {prism.shape}")
                all_passed = False
            
            # Check CRS match
            if nlcd.rio.crs != prism.rio.crs:
                print(f"  ✗ CRS mismatch: {nlcd.rio.crs} != {prism.rio.crs}")
                all_passed = False
            
            # Check spatial overlap with SD County
            if sd_county is not None:
                sd_county_proj = sd_county.to_crs(nlcd.rio.crs)
                nlcd_bounds = nlcd.rio.bounds()
                sd_bounds = sd_county_proj.total_bounds
                
                overlap = not (
                    nlcd_bounds[2] < sd_bounds[0] or
                    nlcd_bounds[0] > sd_bounds[2] or
                    nlcd_bounds[3] < sd_bounds[1] or
                    nlcd_bounds[1] > sd_bounds[3]
                )
                
                if not overlap:
                    print(f"  ✗ No spatial overlap with SD County")
                    all_passed = False
            
            # Check unique classes
            unique_classes = np.unique(nlcd.values[~np.isnan(nlcd.values)])
            print(f"  → {len(unique_classes)} unique landcover classes")
            
        except Exception as e:
            print(f"  ✗ Error checking file: {e}")
            all_passed = False
    
    # Final summary
    print("\n" + "=" * 60)
    if all_passed:
        print("SUCCESS: All NLCD files passed verification!")
    else:
        print("FAILED: Some NLCD files failed verification.")
    print("=" * 60)


def download_nlcd_annual_data(output_dir: Path = OUTPUT_DIR, max_workers: Optional[int] = None) -> None:
    """Download and extract NLCD annual land cover data from 2000-2024."""
    output_dir.mkdir(parents=True, exist_ok=True)

    years = list(range(START_YEAR, END_YEAR + 1))
    if not years:
        return

    worker_count = max_workers or min(5, len(years))

    print(f"Loading San Diego County shapefile")
    if not SD_COUNTY.exists():
        raise FileNotFoundError(f"Shapefile not found at {SD_COUNTY}")
    sd_county = gpd.read_file(SD_COUNTY)

    print(f"Loading PRISM reference grid\n")
    if not PRISM_PATH.exists():
        raise FileNotFoundError(f"PRISM file not found at {PRISM_PATH}")
    prism = rxr.open_rasterio(PRISM_PATH, masked=True)

    nlcd_outputs = []

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_to_year = {
            executor.submit(download_and_extract_year, year, output_dir, sd_county, prism): year
            for year in years
        }

        for future in as_completed(future_to_year):
            year = future_to_year[future]
            try:
                nlcd_output = future.result()
                nlcd_outputs.append(nlcd_output)
            except Exception as exc:
                print(f"Failed to download {year}: {exc}")

    verify_nlcd_output(nlcd_outputs, prism, sd_county)

if __name__ == "__main__":
    download_nlcd_annual_data()
