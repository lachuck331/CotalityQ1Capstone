# Data Storage & Extraction Guide

## Overview

This project processes geospatial data to analyze burn severity in San Diego County. It combines **Monitoring Trends in Burn Severity (MTBS)** mosaic data with **US Census Bureau** county boundaries to extract pixel-level burn severity information for machine learning analysis.

The pipeline consists of two main steps:

1.  **Downloading County Boundaries**: Fetches the latest US county shapefiles.
2.  **Extracting Burn Severity**: Iterates through annual MTBS mosaics, clips them to San Diego County, and aggregates the data into a single Parquet file.

## Prerequisites

Ensure you have the required Python packages installed. This project uses `uv` for dependency management, but standard `pip` works as well.

### Using uv

```bash
uv sync
```

### Using pip

```bash
pip install -r requirements.txt
```

Required packages:

- `geopandas`
- `rasterio`
- `shapely`
- `pandas`
- `numpy`
- `tqdm`
- `pyarrow` (for Parquet support)

## Data Directory Structure

```
data/
├── MTBS_BSmosaics/              # Input: Burn severity mosaics (2000-2024)
│   ├── 2000/
│   │   └── mtbs_CA_2000.zip     # California mosaic for 2000
│   ├── ...
│   └── 2024/
│       └── mtbs_CA_2024.zip
│
├── tl_2025_us_county/           # Input: US County boundaries (Census TIGER/Line)
│   ├── tl_2025_us_county.shp    # Shapefile (main geometry file)
│   ├── tl_2025_us_county.shx    # Shapefile index
│   ├── tl_2025_us_county.dbf    # Shapefile attributes
│   ├── tl_2025_us_county.prj    # Projection info
│   └── tl_2025_us_county.cpg    # Code page
│
└── sd_burn_severity.parquet     # Output: Combined San Diego Burn Severity data
```

## Data Extraction Process

### 1. Download US County Boundaries

Run the `download_census_data.py` script to download and extract the 2025 US County shapefile from the US Census Bureau.

**Using uv:**

```bash
uv run download_census_data.py
```

**Using python:**

```bash
python download_census_data.py
# or
python3 download_census_data.py
```

- **Source**: US Census Bureau TIGER/Line Shapefiles
- **Output**: `data/tl_2025_us_county/`

### 2. Extract San Diego Burn Severity Data

Run the `extract_BSmosaics.py` script to process the MTBS data.

**Using uv:**

```bash
uv run extract_BSmosaics.py
```

**Using python:**

```bash
python extract_BSmosaics.py
# or
python3 extract_BSmosaics.py
```

- **Input**:
  - MTBS Mosaics in `data/MTBS_BSmosaics/`
  - County boundaries in `data/tl_2025_us_county/`
- **Processing**:
  - Filters for San Diego County, CA (State FP 06).
  - Iterates through each year (2000-2024).
  - Clips the burn severity raster to the county boundary.
  - Reprojects to EPSG:4269 (NAD83) to match the county shapefile.
  - Extracts valid data points (excluding nodata).
- **Output**: `data/sd_burn_severity.parquet`
  - **Format**: Parquet (tabular)
  - **Columns**: `x` (longitude), `y` (latitude), `severity` (burn class), `year`
