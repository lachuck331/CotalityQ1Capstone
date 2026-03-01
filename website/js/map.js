const { MapboxOverlay, ScatterplotLayer } = deck;

let currentMapbox = null;
let currentDeckOverlay = null;
let currentData = null;
let activeLandcovers = new Set();
const landcoverNames = {
    'Open_Water': 'Open Water', 'Perennial_Ice_Snow': 'Ice / Snow', 'Developed_Open_Space': 'Developed (Open)',
    'Developed_Low_Intensity': 'Developed (Low)', 'Developed_Medium_Intensity': 'Developed (Med)', 'Developed_High_Intensity': 'Developed (High)',
    'Barren_Land': 'Barren Land', 'Deciduous_Forest': 'Deciduous Forest', 'Evergreen_Forest': 'Evergreen Forest', 'Mixed_Forest': 'Mixed Forest',
    'Dwarf_Scrub': 'Dwarf Scrub', 'Shrub_Scrub': 'Shrub/Scrub', 'Grassland_Herbaceous': 'Grassland', 'Sedge_Herbaceous': 'Sedge',
    'Lichens': 'Lichens', 'Moss': 'Moss', 'Pasture_Hay': 'Pasture/Hay', 'Cultivated_Crops': 'Cultivated Crops',
    'Woody_Wetlands': 'Woody Wetlands', 'Emergent_Herbaceous_Wetlands': 'Emergent Wetlands', 'UNKNOWN': 'Unknown'
};

const landcoverColors = {
    'Open_Water': [70, 130, 180, 200],
    'Perennial_Ice_Snow': [255, 255, 255, 200],
    'Developed_Open_Space': [255, 192, 203, 200],
    'Developed_Low_Intensity': [255, 0, 0, 200],
    'Developed_Medium_Intensity': [139, 0, 0, 200],
    'Developed_High_Intensity': [178, 34, 34, 200],
    'Barren_Land': [169, 169, 169, 200],
    'Deciduous_Forest': [107, 142, 35, 200],
    'Evergreen_Forest': [34, 139, 34, 200],
    'Mixed_Forest': [0, 128, 0, 200],
    'Dwarf_Scrub': [210, 180, 140, 200],
    'Shrub_Scrub': [189, 183, 107, 200],
    'Grassland_Herbaceous': [240, 230, 140, 200],
    'Sedge_Herbaceous': [255, 250, 205, 200],
    'Lichens': [211, 211, 211, 200],
    'Moss': [143, 188, 143, 200],
    'Pasture_Hay': [255, 215, 0, 200],
    'Cultivated_Crops': [218, 165, 32, 200],
    'Woody_Wetlands': [176, 224, 230, 200],
    'Emergent_Herbaceous_Wetlands': [135, 206, 235, 200],
    'UNKNOWN': [50, 50, 50, 200]
};

// Base map view bounds
const INITIAL_VIEW_STATE = {
    longitude: -119.5,
    latitude: 37.0,
    zoom: 5,
    minZoom: 4,
    maxZoom: 15,
    pitch: 25,
    bearing: 0
};

// Variable Ranges for Color Scaling
const RANGES = {
    y_pred_proba: { min: 0, max: 1 },
    y_pred: { min: 0, max: 1 },
    burned_area: { min: 0, max: 1 },
    ppt: { min: 0, max: 200 }, // mm
    tmax: { min: -10, max: 45 }, // celsius
    vpdmax: { min: 0, max: 40 }, // hPa
    ndvi: { min: -0.2, max: 0.9 },
    elevation: { min: 0, max: 3500 }
};

// Map Month Slider Index [0-23] to Actual Dates
function getYearMonthFromIndex(index) {
    const startYear = 2024;
    const year = startYear + Math.floor(index / 12);
    const month = (index % 12) + 1; // 1-aligned
    return { year, month };
}

function getMonthName(monthIndex) {
    const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return names[monthIndex - 1];
}

// Global scope initDemo replacement hooked from script.js
window.initDemo = function () {
    const container = document.getElementById('demoHeatContainer');
    const slider = document.getElementById('t');
    const layerSelect = document.getElementById('layerSelect');

    // Check if demo sections are fully loaded
    if (!container || !slider || !layerSelect) return;

    const timeLabelEl = document.getElementById('timeLabel');
    const mapLoading = document.getElementById('mapLoading');
    const lcToggles = document.getElementById("lcToggles");

    // Scale Elements
    const scaleMax = document.getElementById("scaleMax");
    const scaleMidText = document.getElementById("scaleMidText");
    const scaleMin = document.getElementById("scaleMin");
    const legendBar = document.getElementById("legendBar");

    async function fetchData(sliderIndex) {
        const { year, month } = getYearMonthFromIndex(sliderIndex);

        mapLoading.style.display = 'block';

        try {
            // Local path testing. Will be updated to GH Releases URL later
            const url = `./data/ca/${year}_${month.toString().padStart(2, '0')}.parquet`;

            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            const buffer = await resp.arrayBuffer();

            // Build-free ESM Browser Imports (Auto-polyfills Node `fs` via jsdelivr)
            const { parse, load } = await import('https://cdn.jsdelivr.net/npm/@loaders.gl/core@4.1.4/+esm');
            const { ParquetLoader } = await import('https://cdn.jsdelivr.net/npm/@loaders.gl/parquet@4.1.4/+esm');

            // Parse the data directly on the main thread to avoid Cross-Origin WebWorker crashes
            const tbl = await parse(buffer, ParquetLoader, {
                worker: false
            });

            currentData = tbl;
            updateLandcoverFilters(tbl);
            renderMap();
        } catch (e) {
            console.error("Map Data Error Full Trace:", e);
        } finally {
            mapLoading.style.display = 'none';
        }
    }

    function getColor(value, colName) {
        if (value === undefined || value === null) return [0, 0, 0, 0];

        if (colName === 'burned_area' || colName === 'y_pred') {
            return value > 0.5 ? [255, 30, 30, 200] : [30, 255, 30, 200]; // Red = 1, Green = 0
        }

        const range = RANGES[colName] || { min: 0, max: 1 };
        let ratio = (value - range.min) / (range.max - range.min);
        ratio = Math.max(0, Math.min(1, ratio));

        if (colName === 'y_pred_proba') {
            const r = Math.round(ratio * 255);
            const g = Math.round((1 - ratio) * 255);
            return [r, g, 0, 200]; // Gradient Green to Red
        }

        if (colName === 'ppt') {
            const r = Math.floor(200 - ratio * 200);
            const g = Math.floor(200 - ratio * 100);
            const b = Math.floor(150 + ratio * 100);
            return [r, g, b, 200];
        } else if (colName === 'elevation') {
            return [30 + ratio * 200, 40 + ratio * 180, 40 + ratio * 150, 255]; // Grays/browns
        } else if (colName === 'landcover') {
            // value is a string from the parquet file e.g. 'Shrub_Scrub'
            return landcoverColors[value] || [120, 120, 120, 200];
        }

        // Default Fire Risk Scale
        if (ratio < 0.25) return [20, 30, 80 + ratio * 4 * 100, 255];
        if (ratio < 0.50) return [20 + (ratio - 0.25) * 4 * 180, 130 + (ratio - 0.25) * 4 * 100, 180 + (ratio - 0.25) * 4 * 20, 255];
        if (ratio < 0.75) return [200 + (ratio - 0.5) * 4 * 55, 230 - (ratio - 0.5) * 4 * 100, 200 - (ratio - 0.5) * 4 * 200, 255];
        return [255, 130 - (ratio - 0.75) * 4 * 80, (ratio - 0.75) * 4 * 200, 255];
    }

    function updateLandcoverFilters(tbl) {
        // Render checkboxes using static categories to guarantee all classes are visible, 
        // regardless of chunked loading or 100k row truncation limits
        const sortedLcs = [
            'Open_Water', 'Perennial_Ice_Snow', 'Developed_Open_Space',
            'Developed_Low_Intensity', 'Developed_Medium_Intensity', 'Developed_High_Intensity',
            'Barren_Land', 'Deciduous_Forest', 'Evergreen_Forest', 'Mixed_Forest',
            'Dwarf_Scrub', 'Shrub_Scrub', 'Grassland_Herbaceous', 'Sedge_Herbaceous',
            'Lichens', 'Moss', 'Pasture_Hay', 'Cultivated_Crops',
            'Woody_Wetlands', 'Emergent_Herbaceous_Wetlands'
        ];

        lcToggles.innerHTML = '';
        const allLabel = document.createElement('label');
        allLabel.style.cursor = 'pointer';
        allLabel.style.display = 'flex';
        allLabel.style.alignItems = 'center';
        allLabel.style.gap = '4px';
        allLabel.style.padding = '3px 6px';
        allLabel.style.borderRadius = '4px';
        allLabel.style.border = `1px solid var(--stroke)`;
        allLabel.style.background = activeLandcovers.size === 0 ? 'var(--card-hover)' : 'transparent';
        allLabel.style.transition = 'all 0.2s';
        allLabel.style.fontWeight = '600';
        allLabel.style.fontSize = '10px';
        allLabel.innerHTML = `
            <input type="checkbox" id="lc_all" ${activeLandcovers.size === 0 ? 'checked' : ''} style="display: none;"> 
            <span>All</span>
        `;
        lcToggles.appendChild(allLabel);

        const allCb = allLabel.querySelector('input');

        sortedLcs.forEach(lc => {
            const prettyName = landcoverNames[lc] || lc;
            const color = landcoverColors[lc] || [120, 120, 120, 200];
            const rgbStr = `${color[0]}, ${color[1]}, ${color[2]}`;

            const label = document.createElement('label');
            const isChecked = activeLandcovers.size === 0 || activeLandcovers.has(lc);

            label.style.cursor = 'pointer';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '4px';
            label.style.padding = '3px 6px';
            label.style.borderRadius = '4px';
            label.style.border = isChecked ? `1px solid rgba(${rgbStr}, 0.6)` : `1px solid transparent`;
            label.style.background = isChecked ? `rgba(${rgbStr}, 0.2)` : `transparent`;
            label.style.opacity = isChecked ? '1' : '0.5';
            label.style.transition = 'all 0.15s ease';
            label.style.fontSize = '10px';
            label.style.lineHeight = '1.3';

            label.innerHTML = `
                <input type="checkbox" value="${lc}" ${isChecked ? 'checked' : ''} style="display: none;"> 
                <span style="width:6px;height:6px;border-radius:2px;background:rgba(${rgbStr},${isChecked ? 0.9 : 0.3});flex-shrink:0;"></span>
                <span>${prettyName}</span>
            `;

            // Hover effects
            label.addEventListener('mouseenter', () => {
                if (!label.querySelector('input').checked) {
                    label.style.background = `rgba(${rgbStr}, 0.1)`;
                    label.style.opacity = '0.8';
                }
            });
            label.addEventListener('mouseleave', () => {
                if (!label.querySelector('input').checked) {
                    label.style.background = `transparent`;
                    label.style.border = `1px solid transparent`;
                    label.style.opacity = '0.5';
                }
            });

            lcToggles.appendChild(label);

            label.querySelector('input').addEventListener('change', () => {
                // Update visuals for this button immediately, then run logic
                updateButtonVisuals(label.querySelector('input'));
                syncFilters('single');
            });
        });

        function updateButtonVisuals(cb) {
            const label = cb.closest('label');
            const isChecked = cb.checked;

            if (cb.id === 'lc_all') {
                label.style.background = isChecked ? 'var(--card-hover)' : 'transparent';
            } else {
                const lc = cb.value;
                const color = landcoverColors[lc] || [120, 120, 120, 200];
                const rgbStr = `${color[0]}, ${color[1]}, ${color[2]}`;
                const dotSpan = label.querySelector('span:nth-child(2)');

                label.style.border = isChecked ? `1px solid rgba(${rgbStr}, 0.6)` : `1px solid transparent`;
                label.style.background = isChecked ? `rgba(${rgbStr}, 0.2)` : `transparent`;
                label.style.opacity = isChecked ? '1' : '0.5';
                if (dotSpan) dotSpan.style.background = `rgba(${rgbStr}, ${isChecked ? 0.9 : 0.3})`;
            }
        }

        allCb.addEventListener('change', (e) => {
            const boxes = Array.from(lcToggles.querySelectorAll('input:not(#lc_all)'));
            boxes.forEach(cb => {
                cb.checked = e.target.checked;
                updateButtonVisuals(cb);
            });
            updateButtonVisuals(e.target);
            syncFilters('all');
        });

        function syncFilters(triggerSource = 'single') {
            const allBtn = document.getElementById('lc_all');
            const boxes = Array.from(lcToggles.querySelectorAll('input:not(#lc_all)'));
            const checkedBoxes = boxes.filter(cb => cb.checked);

            // If the user clicked a single box while "ALL" was previously selected
            if (triggerSource === 'single' && allBtn.checked) {
                // Deselect everything except the one they just clicked
                // Because the browser already flipped the clicked one, we need to find it:
                // Actually, if "ALL" was checked, and they clicked ONE, that one just became UNCHECKED logically if it was a normal click.
                // To achieve "Deselect all except clicked":
                // We know which one was clicked because it's the ONLY ONE that is currently UNCHECKED among the siblings!
                const clickedBox = boxes.find(cb => !cb.checked);
                if (clickedBox) {
                    boxes.forEach(cb => {
                        cb.checked = (cb === clickedBox);
                        updateButtonVisuals(cb);
                    });
                }
                allBtn.checked = false;
                updateButtonVisuals(allBtn);
            }
            else if (triggerSource === 'single') {
                // If they check all the boxes manually, switch to All state
                if (checkedBoxes.length === boxes.length) {
                    allBtn.checked = true;
                    updateButtonVisuals(allBtn);
                }
            }

            // Sync with deck.gl layer set
            activeLandcovers.clear();
            if (allBtn.checked) {
                // If "All" is active, deck.gl shows everything. We leave the Set empty to indicate "No filter" to the render loop.
                // Or you can push all values. But previously, size === 0 meant "all".
                // Since user wants "All off = nothing", let's be explicit:
                // We will add a special "_NONE_" flag if no boxes are checked, so it filters everything out.
            } else if (checkedBoxes.length === 0) {
                activeLandcovers.add('_NONE_'); // Filter out all valid landcovers
            } else {
                checkedBoxes.forEach(cb => activeLandcovers.add(cb.value));
            }

            renderMap();
        }
    }

    // Legend elements (cached)
    const legendEl = document.querySelector('.demo-legend');
    const scaleSection = document.querySelector('.demo-legend__section--scale');
    const lcSection = document.querySelector('.demo-legend__section--lc');
    const scaleTitle = document.querySelector('.demo-legend__title-text[data-mode="scale"]');
    const lcTitle = document.querySelector('.demo-legend__title-text[data-mode="lc"]');

    // Two-phase transition helpers
    function hideSection(el) {
        if (!el || el.classList.contains('is-hidden')) return;
        if (el._collapseHandler) {
            el.removeEventListener('transitionend', el._collapseHandler);
        }
        el.classList.add('is-hidden');
        const onEnd = () => {
            el.classList.add('is-collapsed');
            el.removeEventListener('transitionend', onEnd);
            el._collapseHandler = null;
        };
        el._collapseHandler = onEnd;
        el.addEventListener('transitionend', onEnd);
    }
    function showSection(el) {
        if (!el) return;
        if (el._collapseHandler) {
            el.removeEventListener('transitionend', el._collapseHandler);
            el._collapseHandler = null;
        }
        el.classList.remove('is-collapsed');
        void el.offsetHeight;
        el.classList.remove('is-hidden');
    }

    // Standalone legend update — works regardless of data state
    function updateLegend() {
        const colName = layerSelect.value;
        const range = RANGES[colName] || { min: 0, max: 1 };

        // Toggle sections
        if (colName === 'landcover') {
            hideSection(scaleSection);
            showSection(lcSection);
            if (scaleTitle) scaleTitle.classList.add('is-hidden');
            if (lcTitle) lcTitle.classList.remove('is-hidden');
        } else {
            hideSection(lcSection);
            showSection(scaleSection);
            if (scaleTitle) scaleTitle.classList.remove('is-hidden');
            if (lcTitle) lcTitle.classList.add('is-hidden');
        }

        // Save current width
        if (legendEl) legendEl._lastWidth = legendEl.offsetWidth;

        // Crossfade bar + labels
        const fadeDuration = 250;
        const fadeTargets = [legendBar, scaleMax, scaleMidText, scaleMin];
        fadeTargets.forEach(el => { if (el) { el.style.transition = `opacity ${fadeDuration}ms ease`; el.style.opacity = '0'; } });

        setTimeout(() => {
            scaleMax.textContent = range.max;
            scaleMin.textContent = range.min;
            scaleMidText.textContent = layerSelect.options[layerSelect.selectedIndex].text;

            if (colName === 'ppt') {
                legendBar.style.backgroundImage = 'linear-gradient(to top, #c8c896, #0064ff)';
            } else if (colName === 'elevation') {
                legendBar.style.backgroundImage = 'linear-gradient(to top, #1e2828, #e6dede)';
            } else if (colName === 'y_pred' || colName === 'burned_area' || colName === 'y_pred_proba') {
                legendBar.style.backgroundImage = 'linear-gradient(to top, rgb(30, 255, 30), rgb(255, 30, 30))';
            } else if (colName === 'landcover') {
                legendBar.style.backgroundImage = 'linear-gradient(0deg, #000, #333, #777, #aaa, #ccc, #fff)';
            } else {
                legendBar.style.backgroundImage = 'linear-gradient(0deg, #141e50, #c8e6c8, #ff6400, #ff00c8)';
            }

            // Animate width
            if (legendEl) {
                legendEl.style.transition = 'none';
                legendEl.style.width = legendEl._lastWidth + 'px';
                void legendEl.offsetWidth;
                legendEl.style.width = 'fit-content';
                const naturalWidth = legendEl.offsetWidth;
                legendEl.style.width = legendEl._lastWidth + 'px';
                void legendEl.offsetWidth;
                legendEl.style.transition = 'width .3s ease';
                legendEl.style.width = naturalWidth + 'px';
                legendEl._lastWidth = naturalWidth;
            }

            fadeTargets.forEach(el => { if (el) el.style.opacity = '1'; });
        }, fadeDuration);
    }

    function renderMap() {
        if (!currentData) return;

        let displayData = currentData;
        if (activeLandcovers.size > 0 && activeLandcovers.has('_NONE_')) {
            // Nothing selected, show empty map
            displayData = [];
        } else if (activeLandcovers.size > 0) {
            // Locate the array/table structure
            const source = Array.isArray(currentData) ? currentData : (currentData.data || currentData);
            const isArrow = typeof source.get === 'function';
            const len = source.length || 0;
            const filteredArray = [];

            for (let i = 0; i < len; i++) {
                const item = isArrow ? source.get(i) : source[i];
                if (!item) continue;
                const lc = item.landcover !== undefined ? item.landcover : (item.get ? item.get('landcover') : null);
                if (activeLandcovers.has(String(lc))) {
                    filteredArray.push(item);
                }
            }
            displayData = filteredArray;
        }

        const colName = layerSelect.value;
        const range = RANGES[colName] || { min: 0, max: 1 };

        const layer = new ScatterplotLayer({
            id: `wildfire-points-${colName}`, // Unique ID for layer reuse
            data: displayData,
            pickable: true,
            opacity: 0.9,
            stroked: false,
            filled: true,
            radiusUnits: 'meters', // Mapbox globe requires meters to trace earth curvature properly
            radiusScale: 1,
            radiusMinPixels: 2, // Keep dots visible even when zoomed out to globe view
            radiusMaxPixels: 15, // Cap dot sizes when zoomed in extremely close

            getPosition: d => {
                const lon = d.lon !== undefined ? d.lon : (d.get ? d.get('lon') : 0);
                const lat = d.lat !== undefined ? d.lat : (d.get ? d.get('lat') : 0);
                return [lon, lat];
            },
            getFillColor: d => {
                const val = d[colName] !== undefined ? d[colName] : (d.get ? d.get(colName) : 0);
                return getColor(val, colName);
            },
            getRadius: 800 * 0.45, // 800m grid cell mapped to slightly undersized radius (0.45) to prevent overlapping circles
            updateTriggers: {
                getFillColor: [colName]
            }
        });

        // Set up Mapbox behind DeckGL for geographical context
        if (!currentMapbox) {
            mapboxgl.accessToken = 'pk.eyJ1IjoiZ3d1d29uZyIsImEiOiJjbW0wN2F3YWcwNThnM2pxNmQ4ZG1nNWJkIn0.OQ7kRwU3mAlCaWOT4efS-w';
            currentMapbox = new mapboxgl.Map({
                container: 'demoHeatContainer',
                style: 'mapbox://styles/gwuwong/cm7e2vrf800a201so0jledu0k',
                center: [INITIAL_VIEW_STATE.longitude, INITIAL_VIEW_STATE.latitude],
                zoom: INITIAL_VIEW_STATE.zoom,
                minZoom: INITIAL_VIEW_STATE.minZoom,
                maxZoom: INITIAL_VIEW_STATE.maxZoom,
                pitch: INITIAL_VIEW_STATE.pitch,
                bearing: INITIAL_VIEW_STATE.bearing,
                projection: 'mercator', // Globe projection is incompatible with deck.gl overlay — use mercator for proper dot alignment
                maxBounds: [
                    [-135.0, 30.5], // Southwestern corner (Lng, Lat) - Deep Pacific / Baja
                    [-105.0, 42.5]  // Northeastern corner (Lng, Lat) - Midwest / Canada border
                ]
            });

            currentDeckOverlay = new MapboxOverlay({
                interleaved: true,
                layers: [layer],
                getTooltip: ({ object }) => {
                    if (!object) return null;
                    const dynamicCol = layerSelect.value;
                    const val = object[dynamicCol] !== undefined ? object[dynamicCol] : (object.get ? object.get(dynamicCol) : undefined);
                    return {
                        html: `
                               <b>Metric</b>: ${layerSelect.options[layerSelect.selectedIndex].text}<br>
                               <b>Value</b>: ${val !== undefined && val !== null ? val.toLocaleString(undefined, { maximumFractionDigits: 4 }).replace(/_/g, ' ') : 'N/A'}<br>
                               `,
                        className: 'deck-tooltip'
                    };
                }
            });

            currentMapbox.addControl(currentDeckOverlay);
        } else {
            // Using setProps safely updates layers without resetting any viewport/zoom transformations
            currentDeckOverlay.setProps({ layers: [layer] });
        }
    }

    // Connect slider (update label immediately during drag)
    slider.addEventListener("input", () => {
        const idx = parseInt(slider.value, 10) || 0;
        const { year, month } = getYearMonthFromIndex(idx);
        timeLabelEl.textContent = `${getMonthName(month)} ${year}`;
    });

    // Fetch data only after drag is released to save network calls
    slider.addEventListener("change", () => {
        const idx = parseInt(slider.value, 10) || 0;
        fetchData(idx);
    });

    // Connect dropdown
    layerSelect.addEventListener("change", () => {
        updateLegend();
        renderMap();
    });

    // Initial load sync
    const initialIdx = parseInt(slider.value, 10) || 0;
    const { year, month } = getYearMonthFromIndex(initialIdx);
    timeLabelEl.textContent = `${getMonthName(month)} ${year}`;
    fetchData(initialIdx);
};
