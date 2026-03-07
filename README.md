
# California Wildfire Frequency Prediction

Authors: _Stuti Verma_, _Gahn Wuwong_, _Diego Arevalo Fernandez_, _Lacha Barton-Gluzman_  
Mentors: _Ilyes Meftah_, _Aaron Bagnell_

## Project Overview
Traditional wildfire burn probability assessment often relies on computationally expensive physical fire spread simulations, static fuel representations, and limited historical ignition modeling. This project explores a complementary statistical learning approach that estimates historical wildfire burn probabilities using widely available geospatial, climatic, vegetation, and topographic data. We construct a large-scale monthly dataset for California spanning 2000 to 2024 by integrating PRISM climate variables, MTBS wildfire perimeters, MODIS NDVI, NLCD landcover, and USGS DEM terrain data. The objective is to develop a transparent, reproducible framework for probabilistic wildfire risk estimation suitable for large-scale spatial analysis and decision support.

## Problem Description

Wildfire prediction in this project is a highly imbalanced classification problem. Only about 0.4% of observations are positive wildfire cases, while the large majority are non-burned grid-month observations. Because of this, standard accuracy can be misleading, since a model may perform well overall while still failing to detect wildfire events.

For this reason, we focus not only on accuracy, but also on precision, recall, F1 score, ROC AUC, and PR AUC. These metrics better reflect model performance under severe class imbalance.

## Current Progress

The current implementation focuses on scalable data engineering, exploratory analysis, and baseline modeling. We developed a Polars-based preprocessing pipeline for memory-efficient merging, type optimization, feature engineering, and transformation across tens of millions of grid-month observations.

Exploratory Data Analysis identified structured missingness patterns, particularly elevated NDVI missingness in early 2000, which informed our decision to truncate early periods to improve dataset consistency.

Baseline classification experiments using Logistic Regression, Random Forest, and Support Vector Machines demonstrated high overall accuracy but poor wildfire detection due to extreme class imbalance. We subsequently implemented a GPU-accelerated XGBoost classifier, which improved ranking performance as measured by ROC AUC, reaching approximately 0.82 to 0.84 across evaluation splits. Precision-recall performance remains constrained by event rarity, especially on validation data. Feature importance analysis was also conducted to assess model behavior and interpretability.

## Data
This project integrates multiple public geospatial datasets:

### Predictor & Feature Datasets
| Dataset | Details |
|---|---|
| **PRISM Climate** | 800m spatial resolution (Jan 1999 - Dec 2024) |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ Variables | Precipitation, maximum temperature, maximum VPD, mean dewpoint temperature |
| **USGS DEM** | 1 Arc Second DEM files for terrain |
| **MODIS/Terra NDVI** | Vegetation Indices Monthly L3 Global 1km SIN Grid V061 (Feb 2000 - Dec 2024) |
| **NLCD Landcover** | Annual landcover classification (1999 - 2024) |

### Target Dataset
| Dataset | Details |
|---|---|
| **MTBS Fire Perimeters** | Historical wildfire footprints |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ Usage | Used to construct burned (1) / non-burned (0) labels |

### Spatial Domain
| Domain | Scope |
|---|---|
| **Quarter 1** | Originally scoped to San Diego County |
| **Quarter 2** | Expanded to statewide California |

## Repository Structure

The repository is organized into distinct phases of the data science lifecycle, with each phase subdivided into quarters (`quarter_1` for San Diego, `quarter_2` for California).

### Data Collection & Processing
| Path | Description |
|---|---|
| `data_processing/quarter_2/` | Scripts for building the statewide California dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `combine_dataset.py` | Merges processed layers into the final CA modeling dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `download_*.py` | Modules to download CA boundaries, NLCD, PRISM, etc. |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `process_*.py` | Modules to process DEM, MTBS, and NDVI data |
| `data_processing/quarter_1/` | Original San Diego County preprocessing workflow |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `combine_dataset.py` | Combines San Diego County processed datasets |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `download_*.py` | Modules to download SD boundaries, NLCD, PRISM, etc. |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `process_*.py` | Modules to process DEM, MTBS, and NDVI data |

### Exploratory Data Analysis (EDA)
| Path | Description |
|---|---|
| `eda/quarter_2/` | EDA workflows for the California state dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `ca_eda.ipynb` | Exploratory Data Analysis for the California dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `ca_dataprep.ipynb` | Data preparation and feature engineering notebook |
| `eda/quarter_1/` | EDA workflows for the San Diego dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `q1_sd_eda.ipynb` | Exploratory Data Analysis for the SD dataset |

### Modeling
| Path | Description |
|---|---|
| `modeling/quarter_2/` | Modeling workflows for the California state dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `ca_baseline.ipynb` | Baseline model experiments for California data |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `ca_xgboost.ipynb` | XGBoost modeling and evaluation notebook |
| `modeling/quarter_1/` | Modeling workflows for the San Diego dataset |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `q1_sd_models.ipynb` | Baseline modeling experiments for SD data |

### Data & Results
| Path | Description |
|---|---|
| `data/` | Root directory storing generated datasets |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `quarter_2/` | CA datasets (e.g., `ca_combined_data.parquet`) |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `quarter_1/` | SD datasets (e.g., `combined_data_sd.parquet`) |
| `results/` | Output models, metrics, and figures |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `quarter_2/` | Specific outputs for the California domain |
| &nbsp;&nbsp;&nbsp;&nbsp; ↳ `quarter_1/` | Specific outputs for the San Diego domain |

### Configuration
| Path | Description |
|---|---|
| `environment.yml` | Conda environment definition with package versions |
| `pyproject.toml` | Project dependency and package configuration |
| `.python-version` | Python version specification |
| `.gitignore` | Files and directories excluded from Git tracking |
| `README.md` | Project documentation and reproducibility instructions |

## Workflow
1. Data Preprocessing
    <ol type="a">
    <li>Reproject and align all datasets to a common ≈800m spatial grid</li>
    <li>Subset environmental layers to statewide California extent</li>
    <li>Derive terrain features (elevation, slope) from DEM</li>
    <li>Regrid NDVI and NLCD landcover to the analysis grid</li>
    <li>Replicate static and annual layers to monthly resolution</li>
    </ol>

2. Target Variable Construction
    <ol type="a">
    <li>Subset MTBS wildfire perimeters to California (2000–2024)
    <li>Rasterize wildfire footprints onto the monthly grid
    <li>Assign burned (1) and non-burned (0) labels per grid–month
    </ol>
3. Feature Engineering
    <ol type="a">
    <li>Apply log transforms to skewed climate variables
    <li>Encode landcover categories via one-hot representation
    <li>Construct lagged fire history predictors
    <li>Standardize features using training data statistics    
    </ol>
4. Modeling
    <ol type="a">
    <li>Train baseline classifiers (Logistic Regression, Random Forest, SVM)
    <li>Train GPU-accelerated XGBoost classifier
    <li>Address extreme class imbalance (~0.4% positive cases)
    </ol>
5. Evaluation
    <ol type="a">
    <li>Withhold years 2005–2009 as an independent validation set
    <li>Compute precision, recall, F1 score
    <li>Evaluate ROC AUC and PR AUC
    <li>Analyze confusion matrices and spatial prediction behavior
    </ol>
6. Ongoing Work
    <ol type="a">
    <li>Probability calibration and scaling
    <li>SHAP-based interpretability analysis
    <li>Burn probability raster generation
    <li>Structure exposure and risk modeling
    </ol>


## Instructions

**Overview:** This repo contains data download and pre-processing scripts, exploratory notebooks, and model notebooks to reproduce the Capstone analysis. The instructions below describe how to fetch and store data, install dependencies, and run the scripts and notebooks in the intended order.

**Data storage (where files go):**
  - `data/ca_state/` : California boundary / spatial domain files
  - `data/prism/` : PRISM monthly climate files
  - `data/nlcd/` : NLCD annual landcover files
  - `data/mtbs/` : MTBS fire perimeter data
  - `data/dem/` : DEM tiles and derived slope/aspect
  - `data/ndvi/` : MODIS NDVI tiles or regridded outputs

If you prefer a different location, create the directory and adjust the scripts or environment variables inside scripts to point to your path.

## Accessing the data 

The processed California dataset is not stored directly in this repository due to file size constraints. The statewide parquet file exceeds GitHub storage limits and must be generated locally using the provided preprocessing pipeline. Users can recreate the dataset by running the download and processing scripts described below. All intermediate steps are fully reproducible using public data sources.


## Loading the Data From Scratch


```bash
python download_ca_state.py     
python download_prism_data.py    
python download_nlcd_annual.py   
python download_mtbs_data.py     
```

Note: Some datasets are hosted by third parties and may require a stable network connection, a data account, or acceptance of license terms. Inspect the top of each download script for notes about authentication or remote URLs.

After downloads, run the processing scripts to create uniform, analysis-ready layers on the target grid:

```bash
python process_dem_data.py       
python process_ndvi_data.py      
python process_mtbs_data.py      
python combine_dataset.py        
```

## Environment Setup & Software Dependencies

This project uses `environment.yml` and `pyproject.toml` for environment and dependency management.

Recommended steps (Conda, preferred for geospatial stacks):

```bash

conda env create -f environment.yml -n cotality-capstone-q1
conda activate cotality-capstone-q1

pip install -e .
```

If you don't use conda, create and activate a virtualenv and install dependencies via `pip`. There is no `requirements.txt` in the repo; instead, use the `pyproject.toml` or inspect `environment.yml` to determine the packages to `pip install`.

Commonly required packages (non-exhaustive): `numpy`, `pandas`, `xarray`, `rasterio`, `geopandas`, `shapely`, `rioxarray`, `scipy`, `scikit-learn`, `matplotlib`, `pyproj`, `jupyterlab`, `notebook`, `polars`, `xgboost`, and other geospatial utilities. 

GPU acceleration is optional; some modeling experiments use GPU-enabled XGBoost when available.  
Dependency versions are pinned in `environment.yml` and `pyproject.toml`.

## Reproduce results (commands)

1) Prepare environment (see previous section).

Note: Building the full statewide California parquet can take significant disk space and time; the final parquet is not tracked in GitHub and will be generated locally.

2) Download and prepare the data (run scripts in order):

```bash

python download_ca_state.py
python download_prism_data.py
python download_nlcd_annual.py
python download_mtbs_data.py   


python process_dem_data.py
python process_ndvi_data.py
python process_mtbs_data.py
python combine_dataset.py
```

3) Exploratory analysis and modeling


```bash
jupyter lab
```


```bash
jupyter nbconvert --to notebook --execute ca_xgboost.ipynb --output executed_ca_xgboost.ipynb
```

## Unit Testing & Pipeline Automation

The project includes a `pytest` suite to validate the integrity of the data processing scripts and intermediate directory handling. We use a `Makefile` to streamline testing and full pipeline execution.

### Running Tests
To run the automated unit tests covering both the Quarter 1 and Quarter 2 data generation functions, run:
```bash
make test
```

### Executing Full Pipelines via Make
Instead of running discrete processing scripts manually, you can execute the workflows entirely via the Makefile:

**Quarter 1 (San Diego) Pipeline Integration**
- Download data: `make download_q1`
- Process data: `make process_q1`
- Run the full Q1 end-to-end pipeline: `make all_q1`

**Quarter 2 (California) Pipeline Integration**
- Download data: `make download_q2`
- Process data: `make process_q2`
- Run the full Q2 end-to-end pipeline: `make all_q2`

**Utility Commands**
- Install dependencies: `make install`
- Clean up caches: `make clean`
