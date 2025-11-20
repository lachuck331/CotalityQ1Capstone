import urllib.request
import zipfile
from pathlib import Path

def download_census_county_data(output_dir="data/tl_2025_us_county"):
    """
    Download and extract US county shapefile data from Census Bureau.
    
    Parameters:
    -----------
    output_dir : str
        Directory where the data will be saved (default: "data")
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
        
        # Cleanup: Keep only essential shapefile components
        # Essential extensions for a valid shapefile
        keep_extensions = {'.shp', '.shx', '.dbf', '.prj', '.cpg'}
        
        print(f"Cleaning up files in {output_path}...")
        
        # Remove the zip file
        if zip_filename.exists():
            zip_filename.unlink()
            print(f"  - Deleted {zip_filename.name}")

        # Remove non-essential files
        for file in output_path.iterdir():
            if file.is_file():
                if file.suffix.lower() not in keep_extensions:
                    file.unlink()
                    print(f"  - Deleted {file.name}")
        
        print(f"\nFiles saved to: {output_path.absolute()}")
        
        # List remaining files
        print("\nRemaining files:")
        for file in output_path.iterdir():
            if file.is_file():
                print(f"  - {file.name}")
        
        return True
        
    except Exception as e:
        print(f"Error occurred: {e}")
        return False


if __name__ == "__main__":
    download_census_county_data()
