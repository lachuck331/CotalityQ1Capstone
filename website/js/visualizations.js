(function () {
  function cssVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  function debounce(fn, wait = 160) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function ensureTooltip(container) {
    let tip = container.querySelector(".d3-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "d3-tooltip";
      tip.hidden = true;
      container.appendChild(tip);
    }
    return tip;
  }

  function ensurePipelineDialog() {
    let root = document.getElementById("pipelineNodeDialog");
    if (!root) {
      root = document.createElement("div");
      root.id = "pipelineNodeDialog";
      root.className = "vizDialog";
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      root.innerHTML = `
        <div class="vizDialog__overlay" data-close-dialog="true"></div>
        <div class="vizDialog__panel" role="dialog" aria-modal="true" aria-labelledby="pipelineDialogTitle">
          <button class="vizDialog__close" type="button" aria-label="Close dialog" data-close-dialog="true">×</button>
          <h3 id="pipelineDialogTitle" class="vizDialog__title"></h3>
          <p id="pipelineDialogBody" class="vizDialog__body"></p>
        </div>
      `;
      document.body.appendChild(root);
    }

    const title = root.querySelector("#pipelineDialogTitle");
    const body = root.querySelector("#pipelineDialogBody");
    const closeBtn = root.querySelector(".vizDialog__close");

    let closeTimer = null;

    const close = () => {
      if (root.hidden) return;
      root.classList.remove("is-open");
      root.setAttribute("aria-hidden", "true");
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        root.hidden = true;
      }, 360);
    };

    const open = (node) => {
      if (!node) return;
      title.textContent = node.label;
      body.textContent = node.detail;
      window.clearTimeout(closeTimer);
      root.hidden = false;
      root.setAttribute("aria-hidden", "false");
      // Force layout so open-state transitions start immediately on click.
      void root.offsetWidth;
      root.classList.add("is-open");
    };

    if (!root.dataset.bound) {
      root.addEventListener("click", (event) => {
        const target = event.target;
        if (target instanceof HTMLElement && target.dataset.closeDialog === "true") {
          close();
        }
      });
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !root.hidden) close();
      });
      root.dataset.bound = "true";
    }

    return { open, close };
  }

  function setupObserver(target, onEnter) {
    if (!target) return;
    if (!("IntersectionObserver" in window)) {
      onEnter();
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          onEnter();
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.2 });
    io.observe(target);
  }

  function initPipelineViz() {
    const container = document.getElementById("pipelineViz");
    if (!container || !window.d3) return;

    const dialog = ensurePipelineDialog();
    let hasAnimated = false;

    const render = () => {
      const width = Math.max(320, container.clientWidth || 900);
      const isMobile = width < 700;
      const height = isMobile ? 1280 : 1026;
      container.style.minHeight = `${height}px`;

      container.innerHTML = "";
      const svg = d3.select(container)
        .append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("role", "img")
        .attr("aria-label", "Animated wildfire modeling pipeline graph");

      const defs = svg.append("defs");
      defs.append("pattern")
        .attr("id", "pipelineDots")
        .attr("width", 16)
        .attr("height", 16)
        .attr("patternUnits", "userSpaceOnUse")
        .append("circle")
        .attr("cx", 2)
        .attr("cy", 2)
        .attr("r", 1)
        .attr("fill", cssVar("--stroke2", "rgba(0,0,0,.08)"));

      defs.append("marker")
        .attr("id", "pipelineArrow")
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 8)
        .attr("refY", 0)
        .attr("markerWidth", 6)
        .attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", cssVar("--accent", "rgba(0,0,0,.55)"));

      svg.append("rect")
        .attr("x", 10)
        .attr("y", 10)
        .attr("width", width - 20)
        .attr("height", height - 20)
        .attr("rx", 14)
        .attr("fill", "url(#pipelineDots)")
        .attr("stroke", cssVar("--stroke", "rgba(0,0,0,.08)"))
        .attr("opacity", 0.55);

      const nodes = [];
      const links = [];

      if (isMobile) {
        const cx = width / 2;
        const laneW = Math.min(330, width - 58);
        const nodeH = 60;
        const y0 = 64;
        const rowGap = 72;

        const stack = [
          { id: "src", label: "Data Sources", detail: "The modeling workflow combines monthly PRISM climate, NASA MODIS NDVI, USGS NLCD landcover, USGS DEM terrain, and MTBS fire-perimeter labels into ca_combined_data.parquet for statewide California." },
          { id: "src_proc", label: "Per-source Preprocess", detail: "In data preparation, column types are optimized (UInt8, UInt16, and Float32), nulls are audited, and rows that are entirely null are removed." },
          { id: "combine", label: "Combine", detail: "The statewide table is sorted by latitude, longitude, year, and month, and then converted into model-ready feature and target parquet files." },
          { id: "miss", label: "Missingness", detail: "EDA identifies January 2000 NDVI values as by-design missingness, so that month is removed and remaining missingness is handled during downstream filtering and feature construction." },
          { id: "transform", label: "Transformations", detail: "Feature engineering adds a one-step burned_area lag by location, applies log transforms to ppt, vpdmax, and slope (with epsilon), one-hot encodes 20 landcover classes, and scales selected numeric columns." },
          { id: "split", label: "Train/Test/Validation", detail: "The temporal holdout set is defined as 2005-2009, and all remaining years are shuffled and split 70/30 into train and test sets with seed 42." },
          { id: "base", label: "Baseline Models", detail: "Baseline comparisons use cuML LogisticRegression(max_iter=500, class_weight='balanced') and cuML LinearSVC(max_iter=1000); Random Forest was excluded from the final California baseline run due to large computational requirements." },
          { id: "xgb_base", label: "Base XGBoost", detail: "The untuned CUDA XGBoost baseline achieves test ROC-AUC 0.8621 and PR-AUC 0.2272, and on the 2005-2009 temporal holdout it achieves ROC-AUC 0.8512 and PR-AUC 0.0088." },
          { id: "optuna", label: "Optuna XGBoost", detail: "Optuna runs 10 trials to maximize PR-AUC, tuning booster, learning_rate, max_depth, min_child_weight, gamma, regularization, and sampling parameters." },
          { id: "result", label: "Results", detail: "The final tuned XGBoost model reaches test ROC-AUC 0.9448 and PR-AUC 0.5548, while the 2005-2009 temporal holdout reaches ROC-AUC 0.8425 and PR-AUC 0.0113; baseline PR-AUC values remain substantially lower." },
        ];

        stack.forEach((n, i) => {
          nodes.push({
            ...n,
            x: cx - laneW / 2,
            y: y0 + i * rowGap,
            w: laneW,
            h: nodeH,
            kind: i >= 6 ? "train" : "core",
          });
        });

        for (let i = 0; i < nodes.length - 1; i++) links.push({ source: nodes[i], target: nodes[i + 1] });
      } else {
        const nodeH = 60;
        const sourceW = 152;
        const processW = 170;
        const combineW = 154;
        const stageW = 168;
        const baselineW = 152;
        const xgbW = 136;
        const optunaW = 152;
        const resultW = Math.max(154, Math.round(width * 0.12));

        const srcX = Math.round(width * 0.05);
        const procX = Math.round(width * 0.30);
        const combineX = Math.round(width * 0.56);
        const srcYs = [88, 162, 236, 310, 384];

        const sources = [
          { id: "prism", label: "PRISM", detail: "PRISM monthly climate rasters from the PRISM Climate Group (Oregon State University) provide ppt, tdmean, tmax, and vpdmax predictors, with ppt later log-transformed." },
          { id: "ndvi", label: "MODIS NDVI", detail: "MODIS/Terra Vegetation Indices Monthly L3 (NASA, V061) provide NDVI vegetation signals; EDA confirms January 2000 missingness is expected due to satellite startup timing." },
          { id: "nlcd", label: "NLCD", detail: "Annual NLCD landcover classes from the USGS-led MRLC program are incorporated as categorical predictors and expanded into one-hot indicator columns during preparation." },
          { id: "dem", label: "USGS DEM", detail: "USGS 1 arc-second DEM tiles provide terrain-derived elevation, slope, and aspect predictors, with slope later log-transformed for modeling stability." },
          { id: "mtbs", label: "MTBS", detail: "The Monitoring Trends in Burn Severity (MTBS) perimeter dataset (USGS/USFS) is rasterized into burned_area labels, and a one-step location-level lag is added for temporal context." },
        ].map((n, i) => ({ ...n, x: srcX, y: srcYs[i], w: sourceW, h: nodeH, kind: "source" }));

        const preprocess = [
          { id: "prism_pre", label: "Subset + Monthly Align", detail: "Climate columns are validated, typed, and aligned to the monthly statewide table used for modeling." },
          { id: "ndvi_pre", label: "Reproject + Resample", detail: "NDVI layers are reprojected, resampled, and aligned to the monthly modeling timeline after missingness review." },
          { id: "nlcd_pre", label: "Class Mapping", detail: "NLCD classes are mapped into named model categories and expanded into 20 one-hot encoded features." },
          { id: "dem_pre", label: "Terrain Derivation", detail: "DEM-based terrain fields are prepared and retained as continuous predictors alongside climate and vegetation variables." },
          { id: "mtbs_pre", label: "Fire Filter + Rasterize", detail: "MTBS perimeters are filtered and rasterized into burned_area targets, then temporally sorted for lag creation." },
        ].map((n, i) => ({ ...n, x: procX, y: srcYs[i], w: processW, h: nodeH, kind: "pre" }));

        const combine = {
          id: "combine",
          label: "Combine Features",
          detail: "The modeling starts from a pre-merged statewide table, standardizes the schema, and writes train, test, and validation parquet artifacts for features and targets.",
          x: combineX,
          y: 236,
          w: combineW,
          h: nodeH,
          kind: "core",
        };

        const middleY = 540;
        const miss = {
          id: "missingness",
          label: "Missingness",
          detail: "Null diagnostics are completed before modeling; January 2000 NDVI rows are removed as by-design missingness, and all-null rows are filtered out.",
          x: Math.round(width * 0.10),
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };
        const transforms = {
          id: "transforms",
          label: "Transformations",
          detail: "Feature engineering adds lagged burned_area, log transforms for ppt, vpdmax, and slope, landcover one-hot encoding, and z-score scaling for selected columns.",
          x: Math.round(width * 0.36),
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };
        const split = {
          id: "split",
          label: "Train/Test/Validation",
          detail: "Validation years are fixed to 2005-2009, and the remaining samples are shuffled and split 70/30 into train and test sets using seed 42.",
          x: Math.round(width * 0.62),
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };

        const logreg = {
          id: "logreg",
          label: "Logistic Regression",
          detail: "The Logistic Regression baseline uses cuML LogisticRegression(max_iter=500, class_weight='balanced') and achieves test ROC-AUC 0.8703 with PR-AUC 0.0063.",
          x: Math.round(width * 0.08),
          y: 694,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const rf = {
          id: "rf",
          label: "Random Forest",
          detail: "Random Forest was excluded from the final California baseline run due to large computational requirements.",
          x: Math.round(width * 0.08),
          y: 786,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const svm = {
          id: "svm",
          label: "Linear SVM",
          detail: "The Linear SVM baseline uses cuML LinearSVC(max_iter=1000) with decision-function scoring and achieves test ROC-AUC 0.8112 with PR-AUC 0.0020.",
          x: Math.round(width * 0.08),
          y: 878,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const xgbBase = {
          id: "xgb_base",
          label: "Base XGBoost",
          detail: "Before tuning, the base CUDA XGBClassifier achieves test ROC-AUC 0.8621 and PR-AUC 0.2272, while the 2005-2009 temporal holdout reaches ROC-AUC 0.8512 and PR-AUC 0.0088.",
          x: Math.round(width * 0.28),
          y: 786,
          w: xgbW + 8,
          h: nodeH,
          kind: "train",
        };
        const optuna = {
          id: "optuna",
          label: "Optuna XGBoost",
          detail: "An Optuna study with 10 trials maximizes PR-AUC, and the best hyperparameters are used to train final_xgb_clf on the training split.",
          x: Math.round(width * 0.50),
          y: 786,
          w: optunaW,
          h: nodeH,
          kind: "train",
        };
        const results = {
          id: "results",
          label: "Results",
          detail: "The final tuned XGBoost model reaches test ROC-AUC 0.9448 and PR-AUC 0.5548, while the 2005-2009 temporal holdout reaches ROC-AUC 0.8425 and PR-AUC 0.0113; baseline PR-AUC values remain much lower.",
          x: width - resultW - 94,
          y: 786,
          w: resultW,
          h: nodeH,
          kind: "result",
        };

        nodes.push(...sources, ...preprocess, combine, miss, transforms, split, logreg, rf, svm, xgbBase, optuna, results);

        const right = (n) => [n.x + n.w, n.y + n.h / 2];
        const left = (n) => [n.x, n.y + n.h / 2];
        const top = (n) => [n.x + n.w / 2, n.y];
        const bottom = (n) => [n.x + n.w / 2, n.y + n.h];

        sources.forEach((s, i) => {
          links.push({
            source: s,
            target: preprocess[i],
            points: [right(s), left(preprocess[i])],
          });
        });

        /* preprocess → combine: 2 top, 1 left, 2 bottom */
        preprocess.forEach((p, i) => {
          const yMid = p.y + p.h / 2;
          if (i < 2) {
            /* top entries */
            const tx = combine.x + combine.w * 0.2;
            links.push({
              source: p, target: combine,
              points: [right(p), [tx, yMid], [tx, combine.y]],
            });
          } else if (i === 2) {
            /* left entry (same row) */
            links.push({
              source: p, target: combine,
              points: [right(p), left(combine)],
            });
          } else {
            /* bottom entries */
            const bx = combine.x + combine.w * 0.2;
            links.push({
              source: p, target: combine,
              points: [right(p), [bx, yMid], [bx, combine.y + combine.h]],
            });
          }
        });

        const wrapY1 = 482;
        links.push({
          source: combine,
          target: miss,
          points: [
            right(combine),
            [combine.x + combine.w + 26, combine.y + combine.h / 2],
            [combine.x + combine.w + 26, wrapY1],
            [miss.x - 20, wrapY1],
            [miss.x - 20, miss.y + miss.h / 2],
            left(miss),
          ],
        });

        links.push({ source: miss, target: transforms, points: [right(miss), left(transforms)] });
        links.push({ source: transforms, target: split, points: [right(transforms), left(split)] });

        const baselineJunction = [Math.round(width * 0.03), 786 + nodeH / 2];
        const wrapY2 = 650;
        const underRfY = rf.y + rf.h + 18;

        /* split wraps down-left to the baseline junction */
        links.push({
          source: split,
          target: logreg,
          points: [right(split), [split.x + split.w + 26, split.y + split.h / 2], [split.x + split.w + 26, wrapY2], [baselineJunction[0], wrapY2], [baselineJunction[0], logreg.y + logreg.h / 2], [logreg.x - 16, logreg.y + logreg.h / 2], left(logreg)],
        });
        /* junction → rf placeholder path */
        links.push({
          source: split,
          target: rf,
          points: [[baselineJunction[0], logreg.y + logreg.h / 2], [baselineJunction[0], baselineJunction[1]], left(rf)],
        });
        /* junction → svm */
        links.push({
          source: split,
          target: svm,
          points: [[baselineJunction[0], baselineJunction[1]], [baselineJunction[0], svm.y + svm.h / 2], [svm.x - 16, svm.y + svm.h / 2], left(svm)],
        });
        /* junction → route under RF → xgbBase */
        links.push({
          source: split,
          target: xgbBase,
          points: [[baselineJunction[0], baselineJunction[1]], [baselineJunction[0], underRfY], [xgbBase.x - 16, underRfY], [xgbBase.x - 16, xgbBase.y + xgbBase.h / 2], left(xgbBase)],
        });

        links.push({ source: xgbBase, target: optuna, points: [right(xgbBase), left(optuna)] });

        /* baseline models → results: top / left / bottom entries */
        /* logreg (above) → enters results from top */
        links.push({
          source: logreg,
          target: results,
          points: [right(logreg), [results.x + results.w * 0.2, logreg.y + logreg.h / 2], [results.x + results.w * 0.2, results.y]],
        });
        /* optuna (same row) → enters results from left */
        links.push({
          source: optuna,
          target: results,
          points: [right(optuna), left(results)],
        });
        /* svm (below) → enters results from bottom */
        links.push({
          source: svm,
          target: results,
          points: [right(svm), [results.x + results.w * 0.2, svm.y + svm.h / 2], [results.x + results.w * 0.2, results.y + results.h]],
        });
      }

      const linkColor = cssVar("--accent", "rgba(0,0,0,.45)");
      const nodeFill = cssVar("--surface", "#fff");
      const nodeStroke = cssVar("--accent", "#333");
      const textColor = cssVar("--text", "#111");
      const secondary = cssVar("--text-secondary", "#666");

      const linkPath = (d) => {
        if (d.points && d.points.length > 1) {
          let out = `M${d.points[0][0]},${d.points[0][1]}`;
          for (let i = 1; i < d.points.length; i++) out += ` L${d.points[i][0]},${d.points[i][1]}`;
          return out;
        }
        const sxr = d.source.x + d.source.w;
        const sy = d.source.y + d.source.h / 2;
        const txl = d.target.x;
        const ty = d.target.y + d.target.h / 2;
        const mx = sxr + (txl - sxr) * 0.5;
        return `M${sxr},${sy} C${mx},${sy} ${mx},${ty} ${txl},${ty}`;
      };

      const link = svg.append("g")
        .selectAll("path")
        .data(links)
        .join("path")
        .attr("class", "pipeline-link")
        .attr("d", (d) => linkPath(d))
        .attr("fill", "none")
        .attr("stroke", linkColor)
        .attr("stroke-width", (d) => d.iterative ? 1.8 : 1.6)
        .attr("stroke-linecap", "round")
        .attr("stroke-dasharray", (d) => d.iterative ? "4 4" : "6 6")
        .attr("marker-end", "url(#pipelineArrow)")
        .attr("opacity", 0);

      const nodeG = svg.append("g")
        .selectAll("g")
        .data(nodes)
        .join("g")
        .attr("transform", (d) => `translate(${d.x},${d.y})`)
        .attr("class", "pipeline-node")
        .style("cursor", "default")
        .on("click", function (event, d) {
          event.stopPropagation();
          dialog.open(d);
        });

      const rects = nodeG.append("rect")
        .attr("rx", 9)
        .attr("width", (d) => d.w)
        .attr("height", (d) => d.h)
        .attr("fill", nodeFill)
        .attr("stroke", nodeStroke)
        .attr("stroke-width", (d) => d.kind === "result" ? 1.9 : 1.4)
        .attr("opacity", 0.98);

      nodeG.append("text")
        .attr("x", 10)
        .attr("y", 21)
        .attr("text-anchor", "start")
        .attr("fill", textColor)
        .attr("font-size", 11)
        .attr("font-weight", 600)
        .style("pointer-events", "none")
        .text((d) => d.label);

      nodeG.append("text")
        .attr("x", 10)
        .attr("y", 41)
        .attr("text-anchor", "start")
        .attr("fill", secondary)
        .attr("font-size", 10)
        .attr("font-weight", 600)
        .style("pointer-events", "none")
        .text("Click me");

      if (hasAnimated) {
        link.attr("opacity", 0.9)
          .classed("pipeline-link--animated", true);
        return;
      }
      hasAnimated = true;

      /* ---- Links: trace-in then perpetual flow ---- */
      link.each(function () {
        const path = this;
        const len = path.getTotalLength ? path.getTotalLength() : 400;
        d3.select(path)
          .attr("stroke-dasharray", len)
          .attr("stroke-dashoffset", len);
      });
      link
        .transition()
        .duration(900)
        .delay((d, i) => i * 100)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0)
        .attr("opacity", 0.9)
        .on("end", function (d) {
          d3.select(this)
            .attr("stroke-dasharray", d.iterative ? "4 4" : "6 6")
            .attr("stroke-dashoffset", 0)
            .classed("pipeline-link--animated", true);
        });

      /* ---- Nodes: fade + scale entrance ---- */
      nodeG
        .attr("opacity", 0)
        .style("transform-origin", (d) => `${d.x + d.w / 2}px ${d.y + d.h / 2}px`)
        .style("transform", (d) => `translate(${d.x}px,${d.y}px) scale(0.88)`)
        .attr("transform", null)
        .transition()
        .duration(520)
        .delay((d, i) => 80 + i * 55)
        .ease(d3.easeCubicOut)
        .attr("opacity", 1)
        .style("transform", (d) => `translate(${d.x}px,${d.y}px) scale(1)`);

      /* ---- Text: cascade fade after rects ---- */
      nodeG.selectAll("text")
        .attr("opacity", 0)
        .transition()
        .duration(380)
        .delay((d, i, nodes) => {
          const parentIdx = Array.from(nodeG.nodes()).indexOf(nodes[i].parentNode);
          return 280 + parentIdx * 55;
        })
        .ease(d3.easeCubicOut)
        .attr("opacity", 1);
    };

    const rerender = debounce(render, 180);
    window.addEventListener("resize", rerender, { passive: true });
    setupObserver(container, render);
  }

  function initFeatureImportanceViz() {
    const container = document.getElementById("featureImportanceViz");
    const toggleBtn = document.getElementById("importanceToggle");
    if (!container || !toggleBtn || !window.d3) return;

    const wrapper = container.closest(".vizCard") || container.parentElement;
    const tooltip = ensureTooltip(wrapper);
    let fullData = [];
    let showAll = false;
    let observed = false;
    let isToggleAnimating = false;
    let svg = null;
    let xAxisG = null;
    let yAxisG = null;
    let barGroup = null;
    let labelGroup = null;

    container.style.overflow = "hidden";

    const groupColor = (feature) => {
      if (feature.startsWith("landcover_")) return "#8f6fcf";
      if (feature === "month" || feature === "year") return "#5f80db";
      if (["lat", "lon", "elevation", "slope_log", "aspect"].includes(feature)) return "#d9894f";
      if (["ppt_log", "tmax", "tdmean", "vpdmax_log", "ndvi"].includes(feature)) return "#3c9d6e";
      return "#6f7a87";
    };

    const prettyFeature = (name) => name
      .replace(/^landcover_/, "landcover: ")
      .replaceAll("_", " ");

    const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

    const ensureChart = () => {
      if (svg) return;
      container.innerHTML = "";
      svg = d3.select(container)
        .append("svg")
        .attr("role", "img")
        .attr("aria-label", "Tuned model feature importance")
        .style("width", "100%")
        .style("height", "0px")
        .style("display", "block");

      xAxisG = svg.append("g").attr("class", "fi-axis fi-axis--x");
      yAxisG = svg.append("g").attr("class", "fi-axis fi-axis--y");
      barGroup = svg.append("g").attr("class", "fi-bars");
      labelGroup = svg.append("g").attr("class", "fi-values");
      container.style.height = "0px";
    };

    const getData = (all = showAll) => (all ? fullData : fullData.slice(0, 15));

    const getState = (data) => {
      const width = Math.max(320, container.clientWidth || 900);
      const margin = { top: 14, right: 68, bottom: 28, left: 180 };
      const rowHeight = 24;
      const height = margin.top + margin.bottom + data.length * rowHeight;
      const x = d3.scaleLinear()
        .domain([0, d3.max(data, (d) => d.value) || 1])
        .nice()
        .range([margin.left, width - margin.right]);
      const y = d3.scaleBand()
        .domain(data.map((d) => d.feature))
        .range([margin.top, height - margin.bottom])
        .padding(0.25);
      return { data, width, height, margin, x, y };
    };

    const setHeights = (
      state,
      {
        containerMs = null,
        svgMs = null,
        updateContainer = true,
        updateSvg = true
      } = {}
    ) => {
      if (updateSvg) {
        svg.attr("viewBox", `0 0 ${state.width} ${state.height}`);
        if (svgMs === null) {
          svg.style("height", `${state.height}px`);
        } else {
          svg.transition().duration(svgMs).ease(d3.easeCubicInOut).style("height", `${state.height}px`);
        }
      }
      if (updateContainer) {
        if (containerMs === null) {
          container.style.height = `${state.height}px`;
        } else {
          d3.select(container).transition().duration(containerMs).ease(d3.easeCubicInOut).style("height", `${state.height}px`);
        }
      }
    };

    const animateContainerHeight = (state, ms = 260) => {
      const transition = d3.select(container)
        .transition()
        .duration(ms)
        .ease(d3.easeCubicInOut)
        .style("height", `${state.height}px`);
      return transition.end().catch(() => undefined);
    };

    const applyAxes = (state, ms = 0) => {
      const explicitTheme = document.documentElement.getAttribute("data-theme");
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDarkTheme = explicitTheme === "dark" || (!explicitTheme && prefersDark);
      const gridColor = isDarkTheme
        ? "rgba(255,255,255,.22)"
        : "rgba(0,0,0,.30)";
      const axisColor = isDarkTheme
        ? "rgba(255,255,255,.80)"
        : "rgba(0,0,0,.72)";
      if (ms > 0) {
        const xTransition = xAxisG.transition().duration(ms).ease(d3.easeCubicInOut);
        const yTransition = yAxisG.transition().duration(ms).ease(d3.easeCubicInOut);

        xTransition
          .attr("transform", `translate(0,${state.height - state.margin.bottom})`)
          .call(d3.axisBottom(state.x).ticks(6))
          .call((g) => g.selectAll("text").attr("fill", axisColor).attr("font-size", 11))
          .call((g) => g.selectAll("path,line").attr("stroke", gridColor));

        yTransition
          .attr("transform", `translate(${state.margin.left},0)`)
          .call(d3.axisLeft(state.y).tickFormat((d) => prettyFeature(d)))
          .call((g) => g.selectAll("text").attr("fill", axisColor).attr("font-size", 11))
          .call((g) => g.selectAll("path,line").attr("stroke", gridColor));

        return Promise.allSettled([xTransition.end(), yTransition.end()]);
      }

      xAxisG
        .attr("transform", `translate(0,${state.height - state.margin.bottom})`)
        .call(d3.axisBottom(state.x).ticks(6))
        .call((g) => g.selectAll("text").attr("fill", axisColor).attr("font-size", 11))
        .call((g) => g.selectAll("path,line").attr("stroke", gridColor));

      yAxisG
        .attr("transform", `translate(${state.margin.left},0)`)
        .call(d3.axisLeft(state.y).tickFormat((d) => prettyFeature(d)))
        .call((g) => g.selectAll("text").attr("fill", axisColor).attr("font-size", 11))
        .call((g) => g.selectAll("path,line").attr("stroke", gridColor));

      return Promise.resolve();
    };

    const updateMarks = (
      state,
      { ms = 0, hideNew = false, stagger = 0, removeExiting = true } = {}
    ) => {
      const valueColor = cssVar("--text", "#111");

      const bars = barGroup.selectAll("rect").data(state.data, (d) => d.feature);
      if (removeExiting) {
        const exitSel = ms > 0 ? bars.exit().transition().duration(ms).ease(d3.easeCubicInOut) : bars.exit();
        exitSel.attr("width", 0).attr("opacity", 0).remove();
      }

      const barsEnter = bars.enter()
        .append("rect")
        .attr("class", "fi-bar fi-new")
        .attr("x", state.x(0))
        .attr("y", (d) => state.y(d.feature))
        .attr("height", state.y.bandwidth())
        .attr("rx", 4)
        .attr("fill", (d) => groupColor(d.feature))
        .attr("width", 0)
        .attr("opacity", hideNew ? 0 : 1);

      const barsMerge = barsEnter
        .merge(bars)
        .attr("fill", (d) => groupColor(d.feature))
        .on("mouseenter", function (event, d) {
          barGroup.classed("fi-bars--hovered", true);
          d3.select(this).classed("fi-bar--active", true);
          tooltip.hidden = false;
          tooltip.innerHTML = `<strong>${prettyFeature(d.feature)}</strong><br>importance: ${d.value.toFixed(6)}`;
          const rect = wrapper.getBoundingClientRect();
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        })
        .on("mousemove", function (event) {
          const rect = wrapper.getBoundingClientRect();
          tooltip.style.left = `${event.clientX - rect.left + 12}px`;
          tooltip.style.top = `${event.clientY - rect.top + 12}px`;
        })
        .on("mouseleave", function () {
          barGroup.classed("fi-bars--hovered", false);
          d3.select(this).classed("fi-bar--active", false);
          tooltip.hidden = true;
        });

      const barSel = ms > 0 ? barsMerge.transition().duration(ms).ease(d3.easeCubicInOut) : barsMerge;
      if (ms > 0 && stagger > 0) barSel.delay((d, i) => i * stagger);
      barSel
        .attr("x", state.x(0))
        .attr("y", (d) => state.y(d.feature))
        .attr("height", state.y.bandwidth())
        .attr("width", function (d) {
          if (hideNew && this.classList.contains("fi-new")) return 0;
          return Math.max(0, state.x(d.value) - state.x(0));
        })
        .attr("opacity", function () {
          if (hideNew && this.classList.contains("fi-new")) return 0;
          return 1;
        })
        .on("end", function () {
          this.classList.remove("fi-new");
        });

      const labels = labelGroup.selectAll("text").data(state.data, (d) => d.feature);
      if (removeExiting) {
        const labelsExit = ms > 0 ? labels.exit().transition().duration(ms).ease(d3.easeCubicInOut) : labels.exit();
        labelsExit.attr("opacity", 0).remove();
      }

      const labelsEnter = labels.enter()
        .append("text")
        .attr("class", "fi-new-label")
        .attr("x", (d) => state.x(d.value) + 6)
        .attr("y", (d) => (state.y(d.feature) || 0) + state.y.bandwidth() / 2 + 4)
        .attr("fill", valueColor)
        .attr("font-size", 10)
        .attr("opacity", hideNew ? 0 : 1)
        .text((d) => d.value.toFixed(4));

      const labelsMerge = labelsEnter
        .merge(labels)
        .attr("fill", valueColor)
        .text((d) => d.value.toFixed(4));
      const labelSel = ms > 0 ? labelsMerge.transition().duration(ms).ease(d3.easeCubicInOut) : labelsMerge;
      if (ms > 0 && stagger > 0) labelSel.delay((d, i) => i * stagger);
      labelSel
        .attr("x", (d) => state.x(d.value) + 6)
        .attr("y", (d) => (state.y(d.feature) || 0) + state.y.bandwidth() / 2 + 4)
        .attr("opacity", function () {
          if (hideNew && this.classList.contains("fi-new-label")) return 0;
          return 1;
        })
        .on("end", function () {
          this.classList.remove("fi-new-label");
        });
    };

    const depopulateTo = async (targetData, ms = 320, stagger = 18) => {
      const keep = new Set(targetData.map((d) => d.feature));
      const dropOrder = [];

      barGroup.selectAll("rect")
        .filter((d) => !keep.has(d.feature))
        .each(function (d) {
          const y = Number.parseFloat(this.getAttribute("y")) || 0;
          dropOrder.push({ feature: d.feature, y });
        });

      dropOrder.sort((a, b) => b.y - a.y);
      const delayByFeature = new Map(
        dropOrder.map((item, index) => [item.feature, index * stagger])
      );

      const barsToDrop = barGroup.selectAll("rect")
        .filter((d) => !keep.has(d.feature))
        .transition()
        .delay((d) => delayByFeature.get(d.feature) || 0)
        .duration(ms)
        .ease(d3.easeCubicInOut)
        .attr("width", 0)
        .attr("opacity", 0)
        .remove();

      const labelsToDrop = labelGroup.selectAll("text")
        .filter((d) => !keep.has(d.feature))
        .transition()
        .delay((d) => delayByFeature.get(d.feature) || 0)
        .duration(ms)
        .ease(d3.easeCubicInOut)
        .attr("opacity", 0)
        .remove();

      const barsCount = barsToDrop.size ? barsToDrop.size() : 0;
      const labelsCount = labelsToDrop.size ? labelsToDrop.size() : 0;
      const orderedCount = dropOrder.length;
      const maxCount = Math.max(barsCount, labelsCount, orderedCount, 1);
      await wait(ms + ((maxCount - 1) * stagger) + 40);
    };

    const renderImmediate = () => {
      if (!fullData.length) return;
      ensureChart();
      const state = getState(getData());
      setHeights(state, { containerMs: null, svgMs: null });
      applyAxes(state, 0);
      updateMarks(state, { ms: 0, hideNew: false, removeExiting: true });
    };

    const rerender = debounce(() => {
      if (isToggleAnimating) return;
      renderImmediate();
    }, 180);
    window.addEventListener("resize", rerender, { passive: true });

    const rerenderForTheme = debounce(() => {
      if (isToggleAnimating) return;
      renderImmediate();
    }, 60);

    if ("MutationObserver" in window) {
      const htmlThemeObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (m.type === "attributes" && m.attributeName === "data-theme") {
            rerenderForTheme();
            break;
          }
        }
      });
      htmlThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });
    }

    const systemThemeMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    if (systemThemeMq) {
      systemThemeMq.addEventListener("change", () => {
        const selectedTheme = localStorage.getItem("theme") || "system";
        if (selectedTheme === "system") rerenderForTheme();
      });
    }
    window.addEventListener("themechange", rerenderForTheme);

    toggleBtn.addEventListener("click", async () => {
      if (isToggleAnimating || !fullData.length) return;
      isToggleAnimating = true;
      const nextShowAll = !showAll;
      const expanding = nextShowAll;
      toggleBtn.textContent = nextShowAll ? "Show Top 15" : "Show All Features";

      ensureChart();

      if (expanding) {
        const target = fullData;
        const targetState = getState(target);

        await animateContainerHeight(targetState, 320);

        setHeights(targetState, { containerMs: null, svgMs: null, updateContainer: false, updateSvg: true });
        const axisPhase = applyAxes(targetState, 320);
        updateMarks(targetState, { ms: 320, hideNew: true, removeExiting: true });
        await Promise.all([axisPhase, wait(340)]);

        updateMarks(targetState, { ms: 520, hideNew: false, removeExiting: false, stagger: 20 });
        await wait(560);
      } else {
        const target = fullData.slice(0, 15);
        const targetState = getState(target);

        await depopulateTo(target, 380, 24);

        const axisPhase = applyAxes(targetState, 320);
        updateMarks(targetState, { ms: 320, hideNew: false, removeExiting: true });
        await Promise.all([axisPhase, wait(340)]);

        setHeights(targetState, { containerMs: null, svgMs: null, updateContainer: false, updateSvg: true });
        await animateContainerHeight(targetState, 320);
      }

      showAll = nextShowAll;
      isToggleAnimating = false;
    });

    fetch("./data/ca_feature_importance.json")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load feature importance data");
        return res.json();
      })
      .then((json) => {
        fullData = Object.entries(json)
          .map(([feature, value]) => ({ feature, value: Number(value) || 0 }))
          .sort((a, b) => b.value - a.value);

        const start = () => {
          if (observed) return;
          observed = true;
          ensureChart();
          const initialState = getState(getData(false));
          setHeights(initialState, { containerMs: null, svgMs: null });
          applyAxes(initialState, 0);
          updateMarks(initialState, { ms: 0, hideNew: true, removeExiting: true });
          updateMarks(initialState, { ms: 720, hideNew: false, removeExiting: false, stagger: 20 });
        };

        setupObserver(container, start);
        if (!("IntersectionObserver" in window)) start();
      })
      .catch((err) => {
        console.warn(err);
        container.innerHTML = "<p class='vizError'>Unable to load feature importance data.</p>";
      });
  }

  window.initPipelineViz = initPipelineViz;
  window.initFeatureImportanceViz = initFeatureImportanceViz;
})();
