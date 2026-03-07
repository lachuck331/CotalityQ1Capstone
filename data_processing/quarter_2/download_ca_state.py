import urllib.request
import zipfile
from pathlib import Path
import geopandas as gpd
import shutil
from tqdm import tqdm

class DownloadProgressBar(tqdm):
    def update_to(self, b=1, bsize=1, tsize=None):
        if tsize is not None:
            self.total = tsize
        self.update(b * bsize - self.n)

def download_ca_state(output_dir=None):
    if output_dir is None:
        DATA_DIR = Path(__file__).resolve().parent.parent / "data"
        output_dir = DATA_DIR / "ca_state"

    # URL for the 2025 US County shapefile
    url = "https://www2.census.gov/geo/tiger/TIGER2025/STATE/tl_2025_us_state.zip"

    # Create output directory if it doesn't exist
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    # Define the zip file path
    zip_filename = output_path / "tl_2025_us_state.zip"

    # Download the file
    with DownloadProgressBar(unit='B', unit_scale=True, miniters=1, desc="Downloading tl_2025_us_state.zip") as dpb:
        urllib.request.urlretrieve(url, zip_filename, dpb.update_to)
    print(f"\nDownload complete")

    # Extract the zip file
    print(f"\nExtracting files to {output_path}")
    with zipfile.ZipFile(zip_filename, 'r') as zip_ref:
        zip_ref.extractall(output_path)

    print("\nExtraction complete!")

    # Remove the zip file
    if zip_filename.exists():
        zip_filename.unlink()

    # Load the US counties shapefile
    us_shapefile_path = output_path / "tl_2025_us_state.shp"
    print(f"\nLoading shapefile from {us_shapefile_path}")
    states = gpd.read_file(us_shapefile_path)

    # Filter for California
    print("\nFiltering for California...")
    california = states[states['NAME'] == 'California']

    # Save California shapefile
    ca_output_path = output_path / "ca_state.shp"
    print(f"\nSaving California shapefile to {ca_output_path}")
    california.to_file(ca_output_path)

    # Remove original shapefile components
    print(f"\nCleaning up original shapefile components in {output_path}")
    for file in output_path.iterdir():
        if file.name.startswith("tl_2025_us_state"):
            file.unlink()

    print(f"\nProcess complete. Files saved to: {output_path.absolute()}")

if __name__ == "__main__":
    download_ca_state()
