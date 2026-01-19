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
from rasterio.enums import Resampling
import shutil

BASE_URL = "https://www.mrlc.gov/downloads/sciweb1/shared/mrlc/data-bundles"
START_YEAR = 2000
END_YEAR = 2024
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUTPUT_DIR = DATA_DIR / "ca_nlcd_annual"
CA_STATE = DATA_DIR / "ca_state" / "ca_state.shp"
PRISM_PATH = DATA_DIR / "prism_climate" / "ppt" / "ca_prism_ppt_us_30s_200001.nc"

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

def clip_to_ca_state(nlcd_path: Path, ca_state: gpd.GeoDataFrame) -> Path:
    nlcd = rxr.open_rasterio(nlcd_path, masked=True)
    ca_state_nlcd_crs = ca_state.to_crs(nlcd.rio.crs)
    nlcd_clipped = nlcd.rio.clip_box(
        minx=ca_state_nlcd_crs.total_bounds[0] - 10000,
        miny=ca_state_nlcd_crs.total_bounds[1] - 10000,
        maxx=ca_state_nlcd_crs.total_bounds[2] + 10000,
        maxy=ca_state_nlcd_crs.total_bounds[3] + 10000
    )
    
    # Clip to actual polygon geometry to remove data outside state borders
    nlcd_clipped = nlcd_clipped.rio.clip(
        ca_state_nlcd_crs.geometry,
        ca_state_nlcd_crs.crs,
        drop=True,
        invert=False
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
    # print("Upscaling to PRISM grid")
    
    # Mask excluded classes
    nlcd_masked = nlcd_geo.where(~nlcd_geo.isin(EXCLUDED_CLASSES))
    
    # Reproject match to PRISM
    nlcd_coarse = nlcd_masked.rio.reproject_match(
        prism,
        resampling=Resampling.mode
    )
    
    # Save to NetCDF
    nlcd_coarse.to_netcdf(output_path)
    return nlcd_coarse

def download_and_extract_year(year: int, output_dir: Path, ca_state: gpd.GeoDataFrame, prism: xr.DataArray) -> xr.DataArray:
    zip_path = download_zip_for_year(year, output_dir)
    extract_zip(zip_path, zip_path.parent)
    
    # Clip to CA State
    nlcd_path = zip_path.parent / f"Annual_NLCD_LndCov_{year}_CU_C1V1.tif"
    nlcd_geo = clip_to_ca_state(nlcd_path, ca_state)
    
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

def verify_nlcd_output(nlcd_outputs: list[xr.DataArray], prism: xr.DataArray, ca_state: gpd.GeoDataFrame) -> None:
    """Verify all processed NLCD outputs match PRISM grid and overlap with CA State."""
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
            
            # Check spatial overlap with CA State
            if ca_state is not None:
                ca_state_proj = ca_state.to_crs(nlcd.rio.crs)
                nlcd_bounds = nlcd.rio.bounds()
                ca_bounds = ca_state_proj.total_bounds
                
                overlap = not (
                    nlcd_bounds[2] < ca_bounds[0] or
                    nlcd_bounds[0] > ca_bounds[2] or
                    nlcd_bounds[3] < ca_bounds[1] or
                    nlcd_bounds[1] > ca_bounds[3]
                )
                
                if not overlap:
                    print(f"  ✗ No spatial overlap with CA State")
                    all_passed = False
            
            # Check unique classes
            unique_classes = np.unique(nlcd.values[~np.isnan(nlcd.values)])
            # print(f"  → {len(unique_classes)} unique landcover classes")
            
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

    worker_count = max_workers or min(10, len(years))

    print(f"Loading California State shapefile")
    if not CA_STATE.exists():
        raise FileNotFoundError(f"Shapefile not found at {CA_STATE}")
    ca_state = gpd.read_file(CA_STATE)

    print(f"Loading PRISM reference grid\n")
    if not PRISM_PATH.exists():
        raise FileNotFoundError(f"PRISM file not found at {PRISM_PATH}")
    prism = rxr.open_rasterio(PRISM_PATH, masked=True)

    nlcd_outputs = []

    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        future_to_year = {
            executor.submit(download_and_extract_year, year, output_dir, ca_state, prism): year
            for year in years
        }

        for future in as_completed(future_to_year):
            year = future_to_year[future]
            try:
                nlcd_output = future.result()
                nlcd_outputs.append(nlcd_output)
            except Exception as exc:
                print(f"Failed to download {year}: {exc}")

    verify_nlcd_output(nlcd_outputs, prism, ca_state)

if __name__ == "__main__":
    download_nlcd_annual_data()
