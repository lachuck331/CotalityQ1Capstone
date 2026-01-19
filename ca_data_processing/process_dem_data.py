import os
from pathlib import Path
import rioxarray as rxr
import xarray as xr
import numpy as np
from scipy import stats
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading
import geopandas as gpd
from shapely.geometry import box
from shapely.prepared import prep

# Constants
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_DIR = DATA_DIR / "USGS_DEM"
OUTPUT_DIR = DATA_DIR / "ca_usgs_dem"
PRISM_REF_PATH = DATA_DIR / "prism_climate" / "ppt" / "ca_prism_ppt_us_30s_200001.nc"
CA_STATE_PATH = DATA_DIR / "ca_state" / "ca_state.shp"

def get_prism_grid(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"PRISM file not found: {path}")
    prism = rxr.open_rasterio(path)
    return prism

def calculate_slope_aspect_tile(dem: xr.DataArray):
    """Calculate slope and aspect for a single tile (in-memory)."""
    # Prepare Data
    elev = dem.values
    nodata = dem.rio.nodata
    if nodata is not None:
        elev = np.where(elev == nodata, np.nan, elev)
    
    # Gradient (dy, dx)
    grad_y, grad_x = np.gradient(elev)
    
    # Scale Gradients
    res_x = abs(dem.rio.resolution()[0])
    res_y = abs(dem.rio.resolution()[1])
    
    # Initial gradients in units per degree
    slope_y_deg = grad_y / res_y
    slope_x_deg = grad_x / res_x
    
    # Convert to meters if CRS is Geographic
    if dem.rio.crs.to_epsg() == 4269 or dem.rio.crs.is_geographic:
        # We need Y coords for scaling
        Y_coords = dem.coords['y'].values
        lat_rad = np.radians(Y_coords[:, np.newaxis])
        
        scale_x = 111132 * np.cos(lat_rad)
        scale_y = 111132
        
        slope_y_m = slope_y_deg / scale_y
        slope_x_m = slope_x_deg / scale_x
    else:
        # Assume projected meters
        slope_y_m = slope_y_deg
        slope_x_m = slope_x_deg
    
    slope = np.hypot(slope_x_m, slope_y_m)
    
    return elev, slope, slope_x_m, slope_y_m

def process_single_file(f, ca_geom, ca_prepared, lon_edges, lat_edges, stats_lock, accumulators):
    """
    Process a single DEM file, clip to CA shape, and return the stats to accumulate.
    """
    try:
        with rxr.open_rasterio(f, masked=True) as dem:
            dem = dem.squeeze()
            
            # Clip to CA geometry
            dem_box = box(*dem.rio.bounds())
            
            # Fast check with prepared geometry
            if not ca_prepared.intersects(dem_box):
                 return

            try:
                # Clip the DEM to the CA shape
                clipped_dem = dem.rio.clip([ca_geom], dem.rio.crs, drop=True)
            except Exception:
                return
                
            if clipped_dem.size == 0:
                return
            
            dem = clipped_dem
            
            # Calculate vars on the fine grid (Tile only)
            elev, slope, sx, sy = calculate_slope_aspect_tile(dem)
            
            # Get coordinates
            X_fine = dem.coords['x'].values
            Y_fine = dem.coords['y'].values
            Xf, Yf = np.meshgrid(X_fine, Y_fine)
            
            # Flatten arrays
            elev_flat = elev.flatten()
            slope_flat = slope.flatten()
            sx_flat = sx.flatten()
            sy_flat = sy.flatten()
            lon_flat = Xf.flatten()
            lat_flat = Yf.flatten()
            
            mask = ~np.isnan(elev_flat)
            if not np.any(mask):
                return
            
            lons = lon_flat[mask]
            lats = lat_flat[mask]
            
            # Local accumulation for this file
            def get_binned(values, statistic='sum'):
                res = stats.binned_statistic_2d(
                    lons, lats, values,
                    statistic=statistic,
                    bins=[lon_edges, lat_edges]
                )
                return np.nan_to_num(res.statistic.T)
                
            local_count = get_binned(None, 'count')
            local_elev = get_binned(elev_flat[mask])
            local_slope = get_binned(slope_flat[mask])
            local_sx = get_binned(sx_flat[mask])
            local_sy = get_binned(sy_flat[mask])
            
            # Update global accumulators
            with stats_lock:
                accumulators['count'] += local_count
                accumulators['elev'] += local_elev
                accumulators['slope'] += local_slope
                accumulators['sx'] += local_sx
                accumulators['sy'] += local_sy
                
    except Exception as e:
        print(f"Warning: Failed to process {f.name}: {e}")

def verify_output(output_path: Path, prism: xr.DataArray, ca_geom: object):
    """Verify the output file matches PRISM grid and is within CA bounds."""
    print("\nVerifying output...")
    try:
        ds = rxr.open_rasterio(output_path)
        
        # Check Shape
        ds_shape = (ds.rio.height, ds.rio.width)
        prism_shape = (prism.rio.height, prism.rio.width)
        
        if ds_shape != prism_shape:
             print(f"FAILED: Shape mismatch. Output: {ds_shape}, Reference: {prism_shape}")
        
        # Check CRS
        if ds.rio.crs != prism.rio.crs:
            print(f"FAILED: CRS mismatch. Output: {ds.rio.crs}, Reference: {prism.rio.crs}")
        
        # Check Intersect
        ds_bounds = box(*ds.rio.bounds())
        if not ds_bounds.intersects(ca_geom):
             print("FAILED: Output does not intersect CA State shape.")
        else:
             print("SUCCESS: Output file passed verification.")
        
    except Exception as e:
        print(f"FAILED: Verification error: {e}")

def main():
    max_workers = 5

    # Setup Result Grid (PRISM)
    print("Loading Grid Definition...")
    prism = get_prism_grid(PRISM_REF_PATH)
    lonc = prism.coords['x'].values
    latc = prism.coords['y'].values
    
    # Load CA State Shape
    if not CA_STATE_PATH.exists():
        print(f"Error: CA State shapefile not found at {CA_STATE_PATH}")
        return
    
    ca_gdf = gpd.read_file(CA_STATE_PATH)
    ca_gdf = ca_gdf.to_crs("EPSG:4269")
    
    # Simplify geometry for faster clipping/checking
    print("Preparing Geometry...")
    ca_geom = ca_gdf.geometry.union_all().buffer(0)
    ca_prepared = prep(ca_geom)
    
    dx = np.abs(lonc[1] - lonc[0])
    dy = np.abs(latc[1] - latc[0])
    
    # Create strictly increasing bin edges
    x_min, x_max = min(lonc), max(lonc)
    y_min, y_max = min(latc), max(latc)
    
    lon_edges = np.linspace(x_min - dx/2, x_max + dx/2, len(lonc) + 1)
    lat_edges = np.linspace(y_min - dy/2, y_max + dy/2, len(latc) + 1)
    
    # Initialize Accumulators (y, x)
    shape = (len(latc), len(lonc))
    
    accumulators = {
        'elev': np.zeros(shape, dtype=np.float64),
        'slope': np.zeros(shape, dtype=np.float64),
        'sx': np.zeros(shape, dtype=np.float64),
        'sy': np.zeros(shape, dtype=np.float64),
        'count': np.zeros(shape, dtype=np.float64)
    }
    stats_lock = threading.Lock()
    
    # Process Files
    dem_files = list(INPUT_DIR.glob("*.tif"))
    if not dem_files:
        print(f"No .tif files found in {INPUT_DIR}")
        return
    
    with tqdm(total=len(dem_files), desc="Processing Tiles", unit="tile") as pbar:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = []
            for f in dem_files:
                future = executor.submit(process_single_file, f, ca_geom, ca_prepared, lon_edges, lat_edges, stats_lock, accumulators)
                future.add_done_callback(lambda _: pbar.update(1))
                futures.append(future)
            
            for future in as_completed(futures):
                 pass

    # Finalize Aggregation
    print("Finalizing...")
    acc_count = accumulators['count']
    valid = acc_count > 0
    
    fin_elev = np.full(shape, np.nan)
    fin_slope = np.full(shape, np.nan)
    fin_sx = np.full(shape, np.nan)
    fin_sy = np.full(shape, np.nan)
    
    # Compute Means
    fin_elev[valid] = accumulators['elev'][valid] / acc_count[valid]
    fin_slope[valid] = accumulators['slope'][valid] / acc_count[valid]
    fin_sx[valid] = accumulators['sx'][valid] / acc_count[valid]
    fin_sy[valid] = accumulators['sy'][valid] / acc_count[valid]
    
    # Compute Aspect from Mean Vector
    fin_sx = np.where(np.isclose(fin_sx, 0, atol=1e-12), 1e-3, fin_sx)
    fin_aspect = np.arctan2(fin_sy, fin_sx)
    
    # Handle Orientation Flip
    if latc[1] < latc[0]:
        print("Adjusting orientation (flipping Y-axis)...")
        fin_elev = fin_elev[::-1]
        fin_slope = fin_slope[::-1]
        fin_aspect = fin_aspect[::-1]
        
    # Save Output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUTPUT_DIR / "usgs_dem_800m.nc"
    
    ds_out = xr.Dataset(
        {
            "elevation": (("y", "x"), fin_elev),
            "slope": (("y", "x"), fin_slope),
            "aspect": (("y", "x"), fin_aspect),
        },
        coords={
            "y": prism.coords['y'],
            "x": prism.coords['x'],
        }
    )
    
    ds_out.rio.write_crs(prism.rio.crs, inplace=True)
    ds_out.to_netcdf(out_path)
    print(f"Successfully saved full-state DEM to {out_path}")

    # Verify
    verify_output(out_path, prism, ca_geom)

if __name__ == "__main__":
    main()
