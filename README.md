


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
1. Pre-process input data layers to a consistent resolution and domain extent
    <ol type="a">
    <li>Subset monthly PRISM climate variables to a domain that fully encompasses California</li>
    <li>Calculate slope and aspect for the 1 arc second DEM, then upscale elevation, slope, and aspect to the 800m PRISM grid. Replicate layer so that it repeats monthly for the same number of time steps as the climate data </li>
    <li>For each year of NLCD data upscale the land cover classes to the 800m PRISM DEM by calculating the dominant class for each 800m grid cell. Replicate annual files so they are repeated monthly and have the same number of time steps as the climate data</li>
    <li> Use a nearest neighbor algorithm to regrid the monthly MODIS/Terra NDVI to the PRISM 800 m grid</li>
    </ol>

2. Target Variable: Rasterize the MTBS Fire perimeters that intersect the domain over California for the period Jan2000-Dec2024.
    <ol type="a">
    <li>Subset the MTBS dataset to the events that occurred in California and between 2000-2024 and have been labeled as a wildfire
    <li>For each month in the timeseries find all events within your spatial domain and rasterize them to the 800m grid by setting grid cells for that month to 0 if they are outside a fire footprint and 1 if they are within a footprint
    </ol>
3. Train a binary classification model
    <ol type="a">
    <li>Lag the input data layers so they represent the previous month relative to the target variable (e.g. a fire in Jan2001 would pair with climate data from Dec2000)
    <li>Withhold the years 2005-2009 as an independent validation set. Use the remaining data to perform 5-fold cross validation training using logistic regression. Independently save each of the five models trained during cross validation
    <li>Plot the model coefficients for each model to determine the relative importance of the input data layers to building the classification model
    </ol>
4. Validate the classification model
    <ol type="a">
    <li>Apply the trained models to the withheld validation data to predict the burned perimeters during 2005-2009
    <li>>Calculate the average annual observed burn area in km2 and that estimated by model ensemble average
    <li>Plot a timeseries of the modeled and observed monthly burn area
    <li>Map the modeled and observed burn areas and calculate the confusion matrix
    </ol>
5. Construct a burn probability map
    <ol type="a">
    <li>Plot a map of the annual burn probability across San Diego County with labelsover the centroids of some of the major communities: Downtown San Diego, El Cajon, Poway, Escondido, Ramona, and Vista
    </ol>
6. Analyze the impact of the burn probabilities on structures
    <ol type="a">
    <li> a. Use open street map dataset
    <li>b. Construct an exceedance probability curve for the 800m grid cell
    </ol>


## Instructions

**Overview:** This repo contains data download and pre-processing scripts, exploratory notebooks, and model notebooks to reproduce the Capstone analysis. The instructions below describe how to fetch and store data, install dependencies, and run the scripts and notebooks in the intended order.

**Data storage (where files go):**
  - `data/ca_state/` : San Diego County shapefiles (already present in repo for convenience)
  - `data/prism/` : PRISM monthly climate files
  - `data/nlcd/` : NLCD annual landcover files
  - `data/mtbs/` : MTBS fire perimeter data
  - `data/dem/` : DEM tiles and derived slope/aspect
  - `data/ndvi/` : MODIS NDVI tiles or regridded outputs

If you prefer a different location, create the directory and adjust the scripts or environment variables inside scripts to point to your path.

## Accessing the data 

The data is stored and combined in the parquet file in the `data` folder, generated by `combined_dataset.py`. If accessing data straight from the parquet file, please skip the next section below.


## Loading the Data From Scratch


```bash
python download_sd_county.py     
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

Commonly required packages (non-exhaustive): `numpy`, `pandas`, `xarray`, `rasterio`, `geopandas`, `shapely`, `rioxarray`, `scipy`, `scikit-learn`, `matplotlib`, `pyproj`, `jupyterlab`, `notebook`, and other geospatial utilities. 

## Reproduce results (commands)

1) Prepare environment (see previous section).

2) Download and prepare the data (run scripts in order):

```bash

python download_sd_county.py
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

jupyter notebook
```


```bash
jupyter nbconvert --to notebook --execute model.ipynb --output executed_model.ipynb

papermill model.ipynb executed_model.ipynb
```




