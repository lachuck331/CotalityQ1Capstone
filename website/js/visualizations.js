(function () {
  const FEATURE_IMPORTANCE_READY_FLAG = "__cotalityFeatureImportanceReady";
  const FEATURE_IMPORTANCE_READY_EVENT = "cotality:feature-importance-ready";

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
      let height = isMobile ? 960 : 1026;
      const explicitTheme = document.documentElement.getAttribute("data-theme");
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      const isDarkTheme = explicitTheme === "dark" || (!explicitTheme && prefersDark);
      const linkColor = isDarkTheme
        ? "rgba(255,255,255,.56)"
        : "rgba(0,0,0,.62)";

      container.innerHTML = "";
      const svg = d3.select(container)
        .append("svg")
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
        .attr("fill", linkColor);

      const bgRect = svg.append("rect")
        .attr("x", 10)
        .attr("y", 10)
        .attr("width", width - 20)
        .attr("rx", 14)
        .attr("fill", "url(#pipelineDots)")
        .attr("stroke", cssVar("--stroke", "rgba(0,0,0,.08)"))
        .attr("opacity", 0.55);

      const nodes = [];
      const links = [];

      if (isMobile) {
        const cx = width / 2;
        const laneW = Math.min(340, width - 56);
        const nodeH = 62;
        const y0 = 64;
        const rowGap = 96;

        const stack = [
          { id: "src", label: "Data Sources", detail: "The workflow combines public PRISM climate data, NASA MODIS NDVI, NLCD land cover, USGS terrain data, and MTBS wildfire perimeters for statewide California." },
          { id: "src_proc", label: "Grid Alignment", detail: "Each source is clipped or regridded to a common California footprint and PRISM-based reference grid before merging." },
          { id: "combine", label: "Dataset Assembly", detail: "The aligned layers are merged into one monthly table indexed by location and time." },
          { id: "miss", label: "Quality Checks", detail: "Rows outside the shared data footprint are filtered out, and January 2000 is removed because NDVI coverage begins in February 2000." },
          { id: "transform", label: "Feature Engineering", detail: "The model table adds lagged fire history, transformed climate and terrain variables, encoded land cover, and standardized numeric inputs for the linear baselines." },
          { id: "split", label: "Temporal Split", detail: "Years 2005-2009 are held out for temporal validation, and the remaining years are divided into training and test sets." },
          { id: "base", label: "Baseline Models", detail: "Linear and tree-based baselines provide reference points for the statewide modeling task." },
          { id: "xgb_base", label: "XGBoost", detail: "XGBoost is used as the main nonlinear model for capturing interactions across climate, vegetation, terrain, and time." },
          { id: "optuna", label: "XGBoost Tuning", detail: "An Optuna search is used to refine the XGBoost configuration." },
          { id: "result", label: "Results", detail: "Results are summarized with ROC-AUC and PR-AUC on both the random split and the temporal holdout, with PR-AUC emphasized because wildfire occurrence is a rare-event problem. Accuracy, confusion matrices, and classification reports provide additional context." },
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

        const bottom = (n) => [n.x + n.w / 2, n.y + n.h];
        const top = (n) => [n.x + n.w / 2, n.y];
        for (let i = 0; i < nodes.length - 1; i++) {
          links.push({
            source: nodes[i],
            target: nodes[i + 1],
            points: [bottom(nodes[i]), top(nodes[i + 1])],
          });
        }

        const lastNode = nodes[nodes.length - 1];
        height = Math.max(920, Math.ceil(lastNode.y + lastNode.h + 68));
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

        const stageShiftX = Math.round(width * 0.03);
        const trainShiftX = Math.round(width * 0.05);
        const missX = Math.round(width * 0.10) + stageShiftX;
        const transformsX = Math.round(width * 0.36) + stageShiftX;
        const splitX = Math.round(width * 0.62) + stageShiftX;
        const alignToStageColumn = (stageX, nodeW) => stageX + Math.round((stageW - nodeW) / 2);
        const srcX = alignToStageColumn(missX, sourceW);
        const procX = alignToStageColumn(transformsX, processW);
        const combineX = alignToStageColumn(splitX, combineW);
        const srcYs = [88, 162, 236, 310, 384];

        const sources = [
          { id: "prism", label: "PRISM", detail: "Public monthly climate layers from the PRISM Climate Group at Oregon State University provide the reference grid and core weather predictors." },
          { id: "ndvi", label: "MODIS NDVI", detail: "Public MODIS/Terra vegetation index data from NASA provide vegetation greenness signals and begin in February 2000." },
          { id: "nlcd", label: "NLCD", detail: "Public annual land-cover maps from the National Land Cover Database provide categorical context about dominant surface and fuel types." },
          { id: "dem", label: "USGS DEM", detail: "Public USGS digital elevation models provide elevation, from which slope and aspect are derived for each grid cell." },
          { id: "mtbs", label: "MTBS", detail: "Public wildfire perimeter records from the Monitoring Trends in Burn Severity program provide the burned-or-unburned labels for each month." },
        ].map((n, i) => ({ ...n, x: srcX, y: srcYs[i], w: sourceW, h: nodeH, kind: "source" }));

        const preprocess = [
          { id: "prism_pre", label: "Clip to California", detail: "PRISM monthly climate layers are clipped to California and used as the spatial reference for the rest of the pipeline." },
          { id: "ndvi_pre", label: "Regrid to Match", detail: "MODIS NDVI is regridded to the PRISM reference so vegetation values line up with the climate cells." },
          { id: "nlcd_pre", label: "Upscale Land Cover", detail: "Annual land-cover maps are upscaled to the common grid and repeated across months within each year." },
          { id: "dem_pre", label: "Derive Terrain", detail: "Elevation, slope, and aspect are derived from the DEM and aggregated to the same analysis grid." },
          { id: "mtbs_pre", label: "Monthly Labels", detail: "California wildfire perimeters are filtered by year and rasterized by ignition month to create monthly labels." },
        ].map((n, i) => ({ ...n, x: procX, y: srcYs[i], w: processW, h: nodeH, kind: "pre" }));

        const combine = {
          id: "combine",
          label: "Dataset Assembly",
          detail: "The processed layers are merged into one statewide monthly table keyed by location and time.",
          x: combineX,
          y: 236,
          w: combineW,
          h: nodeH,
          kind: "core",
        };

        const middleY = 540;
        const miss = {
          id: "missingness",
          label: "Quality Checks",
          detail: "Rows outside the shared data footprint are removed, and January 2000 is dropped because NDVI coverage begins in February 2000.",
          x: missX,
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };
        const transforms = {
          id: "transforms",
          label: "Feature Engineering",
          detail: "The model table adds lagged fire history, transformed climate and terrain variables, encoded land cover, and standardized numeric predictors for the linear baselines.",
          x: transformsX,
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };
        const split = {
          id: "split",
          label: "Temporal Split",
          detail: "Years 2005-2009 are reserved for temporal validation, and the remaining years are split into training and test sets.",
          x: splitX,
          y: middleY,
          w: stageW,
          h: nodeH,
          kind: "core",
        };

        const logreg = {
          id: "logreg",
          label: "Logistic Regression",
          detail: "Logistic regression serves as a simple linear baseline for the statewide classification task.",
          x: Math.round(width * 0.08) + trainShiftX,
          y: 694,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const rf = {
          id: "rf",
          label: "Random Forest",
          detail: "Random forest was explored as part of the baseline model family.",
          x: Math.round(width * 0.08) + trainShiftX,
          y: 786,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const svm = {
          id: "svm",
          label: "Linear SVM",
          detail: "A linear SVM provides a second baseline with a different decision boundary than logistic regression.",
          x: Math.round(width * 0.08) + trainShiftX,
          y: 878,
          w: baselineW,
          h: nodeH,
          kind: "train",
        };
        const xgbBase = {
          id: "xgb_base",
          label: "XGBoost",
          detail: "XGBoost is the primary nonlinear model used to capture interactions across climate, vegetation, terrain, and time.",
          x: Math.round(width * 0.28) + trainShiftX,
          y: 786,
          w: xgbW + 8,
          h: nodeH,
          kind: "train",
        };
        const optuna = {
          id: "optuna",
          label: "XGBoost Tuning",
          detail: "An Optuna search is used to refine the XGBoost configuration.",
          x: Math.round(width * 0.50) + trainShiftX,
          y: 786,
          w: optunaW,
          h: nodeH,
          kind: "train",
        };
        const results = {
          id: "results",
          label: "Results",
          detail: "Results are summarized with ROC-AUC and PR-AUC on both the random split and the temporal holdout, with PR-AUC emphasized because wildfire occurrence is a rare-event problem. Accuracy, confusion matrices, and classification reports provide additional context.",
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

        const baselineJunction = [Math.round(width * 0.03) + trainShiftX, 786 + nodeH / 2];
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
        links.push({
          source: logreg,
          target: results,
          points: [right(logreg), [results.x + results.w * 0.2, logreg.y + logreg.h / 2], [results.x + results.w * 0.2, results.y]],
        });
        links.push({
          source: optuna,
          target: results,
          points: [right(optuna), left(results)],
        });
        links.push({
          source: svm,
          target: results,
          points: [right(svm), [results.x + results.w * 0.2, svm.y + svm.h / 2], [results.x + results.w * 0.2, results.y + results.h]],
        });
      }

      container.style.minHeight = `${height}px`;
      svg.attr("viewBox", `0 0 ${width} ${height}`);
      bgRect.attr("height", height - 20);

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
    const rerenderForTheme = debounce(render, 120);

    window.addEventListener("resize", rerender, { passive: true });

    if (!container.dataset.pipelineThemeBound) {
      const themeObserver = new MutationObserver((mutations) => {
        mutations.forEach((m) => {
          if (m.type === "attributes" && m.attributeName === "data-theme") {
            rerenderForTheme();
          }
        });
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"]
      });

      const systemThemeMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      if (systemThemeMq) {
        const onSystemThemeChange = () => {
          const selectedTheme = localStorage.getItem("theme") || "system";
          if (selectedTheme === "system") rerenderForTheme();
        };
        if (typeof systemThemeMq.addEventListener === "function") {
          systemThemeMq.addEventListener("change", onSystemThemeChange);
        } else if (typeof systemThemeMq.addListener === "function") {
          systemThemeMq.addListener(onSystemThemeChange);
        }
      }

      window.addEventListener("themechange", rerenderForTheme);
      container.dataset.pipelineThemeBound = "true";
    }

    setupObserver(container, render);
  }

  function initFeatureImportanceViz() {
    const container = document.getElementById("featureImportanceViz");
    const toggleBtn = document.getElementById("importanceToggle");
    if (!container || !toggleBtn || !window.d3) {
      globalThis[FEATURE_IMPORTANCE_READY_FLAG] = true;
      window.dispatchEvent(new CustomEvent(FEATURE_IMPORTANCE_READY_EVENT));
      return;
    }

    const wrapper = container.closest(".vizCard") || container.parentElement;
    const tooltip = ensureTooltip(wrapper);
    let fullData = [];
    let showAll = false;
    let observed = false;
    let isToggleAnimating = false;
    let hasEmittedReady = false;
    let svg = null;
    let xAxisG = null;
    let yAxisG = null;
    let barGroup = null;
    let labelGroup = null;

    const emitFeatureImportanceReady = () => {
      if (hasEmittedReady) return;
      hasEmittedReady = true;
      globalThis[FEATURE_IMPORTANCE_READY_FLAG] = true;
      window.dispatchEvent(new CustomEvent(FEATURE_IMPORTANCE_READY_EVENT));
    };

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
          emitFeatureImportanceReady();
        };

        setupObserver(container, start);
        if (!("IntersectionObserver" in window)) start();
      })
      .catch((err) => {
        console.warn(err);
        container.innerHTML = "<p class='vizError'>Unable to load feature importance data.</p>";
        emitFeatureImportanceReady();
      });
  }

  window.initPipelineViz = initPipelineViz;
  window.initFeatureImportanceViz = initFeatureImportanceViz;
})();
