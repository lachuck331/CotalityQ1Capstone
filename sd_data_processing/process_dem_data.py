import os
from pathlib import Path
import rioxarray as rxr
import xarray as xr
import numpy as np
from scipy import stats
from rioxarray.merge import merge_arrays

# Constants
# Constants
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_DIR = Path.home() / "teams/b13-domain-2/data/USGS_DEM"
OUTPUT_DIR = DATA_DIR / "usgs_dem"
PRISM_REF_PATH = DATA_DIR / "prism_climate" / "ppt" / "sd_prism_ppt_us_30s_200001.nc"

def load_and_merge_dems(input_dir: Path) -> xr.DataArray:
    """Load all TIFF files in input_dir and merge them."""
    dem_files = list(input_dir.glob("*.tif"))
    if not dem_files:
        raise FileNotFoundError(f"No TIFF files found in {input_dir}")
    
    print(f"Found {len(dem_files)} DEM files. Loading and merging...")
    dems = [rxr.open_rasterio(p, masked=True).squeeze() for p in dem_files]
    merged = merge_arrays(dems)
    print(f"Merged DEM shape: {merged.shape}")
    return merged

def get_fine_grid_coords(dem: xr.DataArray):
    """Generate flattened coordinate arrays for the fine grid."""
    X_fine = dem.coords['x'].values
    Y_fine = dem.coords['y'].values
    Xf, Yf = np.meshgrid(X_fine, Y_fine)
    return Xf.flatten(), Yf.flatten()

def calculate_fine_slope_aspect(dem: xr.DataArray):
    """Calculate elevation, slope, and aspect components on the fine grid."""
    print("Calculating slope and aspect on fine grid...")
    elevf = dem.values
    nodata = dem.rio.nodata
    if nodata is not None:
        elevf = np.where(elevf == nodata, np.nan, elevf)

    # Calculate gradients (dy is axis 0, dx is axis 1)
    grad_y, grad_x = np.gradient(elevf)
    
    # Handle units (degrees vs meters)
    if dem.rio.crs.to_epsg() == 4269 or dem.rio.crs.is_geographic:
        res_x = abs(dem.rio.resolution()[0])
        res_y = abs(dem.rio.resolution()[1])
        
        # Convert gradients to degrees
        slope_y_deg = grad_y / res_y
        slope_x_deg = grad_x / res_x
        
        # Scale to meters
        Y_fine = dem.coords['y'].values
        _, Yf = np.meshgrid(dem.coords['x'].values, Y_fine)
        
        lat_rad = np.radians(Yf)
        scale_x = 111132 * np.cos(lat_rad)
        scale_y = 111132
        
        slope_y_m = slope_y_deg / scale_y
        slope_x_m = slope_x_deg / scale_x
    else:
        # Assume projected meters
        res_x = abs(dem.rio.resolution()[0])
        res_y = abs(dem.rio.resolution()[1])
        slope_y_m = grad_y / res_y
        slope_x_m = grad_x / res_x

    slopef = np.hypot(slope_x_m, slope_y_m)
    
    return elevf, slopef, slope_x_m, slope_y_m

def upscale_variable(lonf, latf, data, lon_edges, lat_edges, statistic='mean'):
    """Upscale a single variable using binned_statistic_2d."""
    mask = ~np.isnan(data)
    ret = stats.binned_statistic_2d(
        lonf[mask], 
        latf[mask], 
        data[mask], 
        statistic=statistic, 
        bins=[lon_edges, lat_edges]
    )
    return ret.statistic.T

def process_upscaling(elevf, slopef, slope_x, slope_y, lonf, latf, prism):
    """Upscale all variables to the PRISM grid."""
    print("Upscaling to PRISM grid...")
    lonc = prism.coords['x'].values
    latc = prism.coords['y'].values
    
    # Calculate bin edges
    dx = np.abs(lonc[1] - lonc[0])
    dy = np.abs(latc[1] - latc[0])
    
    if lonc[1] > lonc[0]:
        lon_edges = np.append(lonc - dx/2, lonc[-1] + dx/2)
    else:
        lon_edges = np.append(lonc + dx/2, lonc[-1] - dx/2)
        
    if latc[1] > latc[0]:
        lat_edges = np.append(latc - dy/2, latc[-1] + dy/2)
    else:
        lat_edges = np.append(latc + dy/2, latc[-1] - dy/2)
    
    # Ensure increasing
    if lon_edges[0] > lon_edges[-1]: lon_edges = lon_edges[::-1]
    if lat_edges[0] > lat_edges[-1]: lat_edges = lat_edges[::-1]

    # Upscale
    elevc = upscale_variable(lonf, latf, elevf.flatten(), lon_edges, lat_edges)
    slopec = upscale_variable(lonf, latf, slopef.flatten(), lon_edges, lat_edges)
    slopec_x = upscale_variable(lonf, latf, slope_x.flatten(), lon_edges, lat_edges)
    slopec_y = upscale_variable(lonf, latf, slope_y.flatten(), lon_edges, lat_edges)
    
    # Recalculate aspect from upscaled components
    slopec_x = np.where(np.isclose(slopec_x, 0, atol=1e-12), 1e-3, slopec_x)
    aspectc = np.arctan2(slopec_y, slopec_x)
    
    return elevc, slopec, aspectc

def save_output(elevc, slopec, aspectc, prism, output_dir):
    """Save the processed data to NetCDF."""
    print("Saving output...")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    ds_out = xr.Dataset(
        {
            "elevation": (("y", "x"), elevc),
            "slope": (("y", "x"), slopec),
            "aspect": (("y", "x"), aspectc),
        },
        coords={
            "y": prism.coords['y'],
            "x": prism.coords['x'],
        }
    )
    
    ds_out.rio.write_crs(prism.rio.crs, inplace=True)
    out_path = output_dir / "usgs_dem_800m.nc"
    ds_out.to_netcdf(out_path)
    print(f"Saved to {out_path}")
    return out_path

def verify_output(output_path: Path, prism: xr.DataArray):
    """Verify the output file matches PRISM grid."""
    print("\nVerifying output...")
    try:
        ds = rxr.open_rasterio(output_path)
        
        # Check Shape
        # ds is a Dataset, prism is a DataArray
        ds_shape = (ds.rio.height, ds.rio.width)
        prism_shape = (prism.rio.height, prism.rio.width)
        
        if ds_shape != prism_shape:
             print(f"FAILED: Shape mismatch. Output: {ds_shape}, Reference: {prism_shape}")
             return

        # Check CRS
        if ds.rio.crs != prism.rio.crs:
            print(f"FAILED: CRS mismatch. Output: {ds.rio.crs}, Reference: {prism.rio.crs}")
            return

        # Check Bounds
        r_bounds = ds.rio.bounds()
        ref_bounds = prism.rio.bounds()
        # Allow small float diff
        if not np.allclose(r_bounds, ref_bounds, atol=1e-3):
             print(f"FAILED: Bounds mismatch.\nOutput: {r_bounds}\nReference: {ref_bounds}")
             return
             
        print("SUCCESS: Output file passed verification.")
        
    except Exception as e:
        print(f"FAILED: Verification error: {e}")
        import traceback
        traceback.print_exc()

def main():
    # 1. Load Data
    dem = load_and_merge_dems(INPUT_DIR)
    
    if not PRISM_REF_PATH.exists():
        print(f"PRISM reference file not found: {PRISM_REF_PATH}")
        return
    prism = rxr.open_rasterio(PRISM_REF_PATH)
    
    # 2. Prepare Fine Grid
    lonf, latf = get_fine_grid_coords(dem)
    
    # 3. Calculate Fine Scale Variables
    elevf, slopef, slope_x, slope_y = calculate_fine_slope_aspect(dem)
    
    # 4. Upscale
    elevc, slopec, aspectc = process_upscaling(elevf, slopef, slope_x, slope_y, lonf, latf, prism)
    
    # 5. Save
    out_path = save_output(elevc, slopec, aspectc, prism, OUTPUT_DIR)
    
    # 6. Verify
    verify_output(out_path, prism)

if __name__ == "__main__":
    main()
