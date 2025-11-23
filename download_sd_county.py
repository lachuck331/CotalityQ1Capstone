import urllib.request
import zipfile
from pathlib import Path
import geopandas as gpd
import shutil

def download_census_county_data(output_dir="data/sd_county"):
    """
    Download and extract US county shapefile data from Census Bureau,
    then filter for San Diego County.
    
    Parameters:
    -----------
    output_dir : str
        Directory where the data will be saved (default: "data/sd_county")
    """
    # URL for the 2025 US County shapefile
    url = "https://www2.census.gov/geo/tiger/TIGER2025/COUNTY/tl_2025_us_county.zip"
    
    # Create output directory if it doesn't exist
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Define the zip file path
    zip_filename = output_path / "tl_2025_us_county.zip"
    
    print(f"Downloading data from {url}")
    
    try:
        # Download the file
        urllib.request.urlretrieve(url, zip_filename)
        print(f"Download complete: {zip_filename}")
        
        # Extract the zip file
        print(f"Extracting files to {output_path}")
        with zipfile.ZipFile(zip_filename, 'r') as zip_ref:
            zip_ref.extractall(output_path)
        
        print("Extraction complete!")
        
        # Remove the zip file
        if zip_filename.exists():
            zip_filename.unlink()

        # Load the US counties shapefile
        us_shapefile_path = output_path / "tl_2025_us_county.shp"
        print(f"Loading shapefile from {us_shapefile_path}")
        counties = gpd.read_file(us_shapefile_path)
        
        # Filter for San Diego County
        print("Filtering for San Diego County...")
        sd_county = counties[counties["NAME"] == "San Diego"]
        
        # Save San Diego shapefile
        sd_output_path = output_path / "sd_county.shp"
        print(f"Saving San Diego shapefile to {sd_output_path}")
        sd_county.to_file(sd_output_path)
        
        # Cleanup: Remove original shapefile components
        print(f"Cleaning up original shapefile components in {output_path}")
        for file in output_path.iterdir():
            if file.name.startswith("tl_2025_us_county"):
                file.unlink()
        
        print(f"\nProcess complete. Files saved to: {output_path.absolute()}")
        
        return True
        
    except Exception as e:
        print(f"Error occurred: {e}")
        return False


if __name__ == "__main__":
    download_census_county_data()
