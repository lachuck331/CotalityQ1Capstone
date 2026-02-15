


Mentors: _Ilyes Meftah_, _Aaron Bagnell_

Traditional wildfire burn probability assessment often relies on computationally expensive physical fire spread simulations, static fuel representations, and limited historical ignition modeling. This project explores a complementary statistical learning approach that estimates historical wildfire burn probabilities using widely available geospatial, climatic, vegetation, and topographic data. We construct a large-scale monthly dataset for California spanning 2000 to 2024 by integrating PRISM climate variables, MTBS wildfire perimeters, MODIS NDVI, NLCD landcover, and USGS DEM terrain data. The objective is to develop a transparent, reproducible framework for probabilistic wildfire risk estimation suitable for large-scale spatial analysis and decision support.

The current implementation focuses on scalable data engineering, exploratory analysis, and baseline modeling. We developed a Polars-based preprocessing pipeline for memory-efficient merging, type optimization, feature engineering, and transformation across tens of millions of grid–month observations. Exploratory Data Analysis (EDA) identified structured missingness patterns, particularly elevated NDVI missingness in early 2000, which informed our decision to truncate early periods to improve dataset consistency. Baseline classification experiments using Logistic Regression and Support Vector Machines demonstrated high overall accuracy but poor wildfire detection due to extreme class imbalance (~0.4% positive cases). We subsequently implemented a GPU-accelerated XGBoost classifier, which improved ranking performance as measured by ROC AUC (≈0.82 to 0.84 across evaluation splits). Precision–recall performance remains constrained by event rarity, especially on validation data. Feature importance analysis was conducted to assess model behavior and interpretability. 

## Data
This project integrates multiple public geospatial datasets:
### <u>Predictor/Feature Datasets </u>
    1) PRISM climate at 800m spatial resolution (Jan1999-Dec2024)
        Variables: Precipitation, maximum temperature, maximum VPD, mean dewpoint temperature
    2) USGS 1 Arc Second DEM files
    3) MODIS/Terra Vegetation Indices Monthly L3 Global 1km SIN Grid V061 for the period (Feb2000-Dec2024)
    4) Annual NLCD landcover for the period 1999-2024

### <u>Target Dataset</u>
    5) MTBS Fire Perimeter dataset
        Historical wildfire footprints used to construct burned/non-burned labels

### <u>Spatial Domain dataset</u>
    6) Originally scoped to San Diego County, now expanded to statewide California

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

## Software dependencies


Recommended steps (Conda, preferred for geospatial stacks):

```bash

conda env create -f environment.yml -n cotality-capstone-q1
conda activate cotality-capstone-q1

pip install -e .
```

If you don't use conda, create and activate a virtualenv and install dependencies via `pip`. There is no `requirements.txt` in the repo; instead, use the `pyproject.toml` or inspect `environment.yml` to determine the packages to `pip install`.

Commonly required packages (non-exhaustive): `numpy`, `pandas`, `xarray`, `rasterio`, `geopandas`, `shapely`, `rioxarray`, `scipy`, `scikit-learn`, `matplotlib`, `pyproj`, `jupyterlab`, `notebook`, `polars`, `xgboost`, and other geospatial utilities. 

GPU acceleration is optional; some modeling experiments use GPU-enabled XGBoost when available.

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




