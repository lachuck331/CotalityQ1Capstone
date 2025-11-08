# Cotality: Q1 Capstone 
_Lacha Barton-Gluzman, Stuti Verma, Diego Arevalo, Gahn Wuwong_

Mentor: _Ilyes Meftah_

Traditional wildfire burn probability assessment relies heavily on expensive physical fire spread model simulations, static fuel cover, and outdated historical ignitions. This project will explore whether we can estimate historical fire burn probabilities using widely available and dynamic geospatial, vegetation, topographic, and weather data instead. Using historical wildfire perimeter data from the Monitoring Trends in Burn Severity (MTBS) program for San Diego County, we will replicate and adapt the statistical methods presented in Climate Risks From Stress, Insects and Fire Across US Forests. (1). Model performance will be evaluated through cross-validation and out-of-sample testing (2005–2009), followed by spatial mapping of ensemble burn probabilities and an assessment of structures at risk. The resulting framework aims to provide a cost-efficient, reproducible method for local wildfire risk assessment and real-time resilience planning. 

Though we have not gotten to code yet, our detailed plan for the data sources and technical implementation of our project is below. 

## Data
We will use the following six data sources, classified as either Training, Predictor, or Spacial Domain.
### <u>Training datasets </u>
    1) PRISM climate at 800m spatial resolution (Jan1999-Dec2024)
        Variables: Precipitation, maximum temperature, maximum VPD, mean dewpoint temperature
    2) USGS 1 Arc Second DEM files
    3) MODIS/Terra Vegetation Indices Monthly L3 Global 1km SIN Grid V061 for the period (Feb2000-Dec2024)
    4) Annual NLCD landcover for the period 1999-2024

### <u>Predictor Datasets</u>
    5) MTBS Fire Perimeter dataset

### <u>Spatial Domain dataset</u>
    6) Polygon shapefile of San Diego County

## Workflow
1. Pre-process input data layers to a consistent resolution and domain extent
    <ol type="a">
    <li>Subset monthly PRISM climate variables to a domain that fully encompasses San Diego County</li>
    <li>Calculate slope and aspect for the 1 arc second DEM, then upscale elevation, slope, and aspect to the 800m PRISM grid. Replicate layer so that it repeats monthly for the same number of time steps as the climate data </li>
    <li>For each year of NLCD data upscale the land cover classes to the 800m PRISM DEM by calculating the dominant class for each 800m grid cell. Replicate annual files so they are repeated monthly and have the same number of time steps as the climate data</li>
    <li> Use a nearest neighbor algorithm to regrid the monthly MODIS/Terra NDVI to the PRISM 800 m grid</li>
    </ol>

2. Target Variable: Rasterize the MTBS Fire perimeters that intersect the domain over San Diego County for the period Jan2000-Dec2024.
    <ol type="a">
    <li>Subset the MTBS dataset to the events that occurred in CA and between 2000-2024 and have been labeled as a wildfire
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