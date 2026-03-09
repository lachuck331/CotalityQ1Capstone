
// Tracing Beam — Section-driven alternating path
// The line runs at two X positions (left lane / right lane).
// Between each section, a 45° diagonal shifts the line to the other lane.
// Dots sit on the line at their section's lane position.
// Glow follows scroll position smoothly like a scrollbar.

const TracingBeam = (() => {
  const SECTIONS = [
    { id: "top",          label: "Home" },
    { id: "introduction", label: "Intro" },
    { id: "pipeline",     label: "Pipeline" },
    { id: "methodology",  label: "Methods" },
    { id: "results",      label: "Results" },
    { id: "limitations",  label: "Next Steps" },
    { id: "team",         label: "Team" },
  ];

  // Two horizontal lanes (in CSS pixels from container left)
  const X_LEFT = 50;
  const X_RIGHT = 76;
  const SHIFT = X_RIGHT - X_LEFT;   // 26px horiz → 26px vert at 45°

  let beamEl, svgEl, pathBg, pathGlow, pathCore, dotsContainer;
  let dotEls = [];
  let totalLen = 0;

  // Compute where each dot goes (alternating lanes, evenly spaced Y)
  function computeDotPositions(vh) {
    const positions = [];
    const startY = vh * 0.06;
    const endY = vh * 0.94;
    const n = SECTIONS.length;

    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : i / (n - 1);
      const y = startY + frac * (endY - startY);
      const x = i % 2 === 0 ? X_LEFT : X_RIGHT;
      positions.push({ x, y });
    }
    return positions;
  }

  // Build path that goes through each dot with 45° diagonal transitions
  // The diagonal is centered between consecutive dots so each dot sits
  // in the vertical middle of its straight segment.
  function buildPath(dotPositions, vh) {
    const first = dotPositions[0];
    let d = `M ${first.x},0`;  // start at top in the first lane

    for (let i = 0; i < dotPositions.length; i++) {
      const dot = dotPositions[i];

      // Straight down to this dot
      d += ` L ${dot.x},${dot.y}`;

      if (i < dotPositions.length - 1) {
        const next = dotPositions[i + 1];
        const gap = next.y - dot.y;
        const diagVertical = Math.abs(next.x - dot.x);

        // Center the diagonal in the gap between dots
        const padding = (gap - diagVertical) / 2;
        const diagStart = dot.y + padding;
        const diagEnd = diagStart + diagVertical;

        d += ` L ${dot.x},${diagStart}`;
        d += ` L ${next.x},${diagEnd}`;
      }
    }

    // Continue straight down to the bottom
    const last = dotPositions[dotPositions.length - 1];
    d += ` L ${last.x},${vh}`;

    return d;
  }

  // ---- DOM construction ----
  function build() {
    const vh = window.innerHeight;

    beamEl = document.createElement("aside");
    beamEl.className = "tracing-beam";
    beamEl.setAttribute("aria-label", "Page navigation");

    // SVG — viewBox matches viewport pixels so coordinates are 1:1
    svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("class", "tracing-beam__svg");
    svgEl.setAttribute("viewBox", `0 0 220 ${vh}`);
    svgEl.setAttribute("preserveAspectRatio", "none");

    // Glow filter
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
    filter.setAttribute("id", "beamBlur");
    filter.setAttribute("x", "-50%");
    filter.setAttribute("y", "-2%");
    filter.setAttribute("width", "200%");
    filter.setAttribute("height", "104%");
    const blur = document.createElementNS("http://www.w3.org/2000/svg", "feGaussianBlur");
    blur.setAttribute("stdDeviation", "4");
    filter.appendChild(blur);
    defs.appendChild(filter);
    svgEl.appendChild(defs);

    const dotPositions = computeDotPositions(vh);
    const pathD = buildPath(dotPositions, vh);

    // Background (full path, dim)
    pathBg = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathBg.setAttribute("class", "tracing-beam__path-bg");
    pathBg.setAttribute("d", pathD);
    svgEl.appendChild(pathBg);

    // Glow (wider blur, clipped by dashoffset)
    pathGlow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathGlow.setAttribute("class", "tracing-beam__path-glow");
    pathGlow.setAttribute("d", pathD);
    svgEl.appendChild(pathGlow);

    // Core line (sharp, also clipped)
    pathCore = document.createElementNS("http://www.w3.org/2000/svg", "path");
    pathCore.setAttribute("class", "tracing-beam__path-core");
    pathCore.setAttribute("d", pathD);
    svgEl.appendChild(pathCore);

    beamEl.appendChild(svgEl);

    // Dots container
    dotsContainer = document.createElement("div");
    dotsContainer.className = "tracing-beam__dots";

    SECTIONS.forEach((sec, i) => {
      const dot = document.createElement("button");
      dot.className = "tracing-beam__dot";
      dot.textContent = sec.label;
      dot.dataset.index = i;
      dot.dataset.target = sec.id;

      // Position at the computed lane
      dot.style.left = `${dotPositions[i].x}px`;
      dot.style.top = `${(dotPositions[i].y / vh) * 100}%`;

      dot.addEventListener("click", () => {
        if (sec.id === "top" || sec.id === "home") {
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        const target = document.getElementById(sec.id);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });

      dotsContainer.appendChild(dot);
      dotEls.push(dot);
    });

    beamEl.appendChild(dotsContainer);
    document.body.appendChild(beamEl);
  }

  // ---- Setup after build ----
  function measure() {
    totalLen = pathBg.getTotalLength();

    // Compute path fraction for each dot's Y position
    const vh = window.innerHeight;
    const dotPositions = computeDotPositions(vh);

    dotEls.forEach((dot, i) => {
      // Find the path fraction that corresponds to this dot's Y
      // Binary search for the point on the path closest to the dot's Y
      const targetY = dotPositions[i].y;
      let lo = 0, hi = totalLen;
      for (let iter = 0; iter < 30; iter++) {
        const mid = (lo + hi) / 2;
        const pt = pathBg.getPointAtLength(mid);
        if (pt.y < targetY) lo = mid; else hi = mid;
      }
      dot.dataset.pathFrac = ((lo + hi) / 2 / totalLen).toString();
    });
  }

  // ---- Update glow synced to actual section positions on the page ----
  function updateGlow() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const vh = window.innerHeight;

    // Get the actual top-of-page offset for each section element
    const sectionTops = SECTIONS.map(sec => {
      const el = document.getElementById(sec.id);
      if (!el) return 0;
      return el.getBoundingClientRect().top + scrollTop;
    });

    // Find which section we're currently in (the last section whose top we've passed)
    let activeIdx = 0;
    for (let i = 0; i < sectionTops.length; i++) {
      if (scrollTop + vh * 0.15 >= sectionTops[i]) {
        activeIdx = i;
      }
    }

    // Compute interpolation: how far between activeIdx and activeIdx+1
    const pathFracs = dotEls.map(d => parseFloat(d.dataset.pathFrac));
    let progress;

    if (activeIdx >= SECTIONS.length - 1) {
      progress = pathFracs[pathFracs.length - 1];
    } else {
      const currentTop = sectionTops[activeIdx];
      const nextTop = sectionTops[activeIdx + 1];
      const span = nextTop - currentTop;
      const t = span > 0 ? Math.min(1, Math.max(0, (scrollTop + vh * 0.15 - currentTop) / span)) : 0;
      progress = pathFracs[activeIdx] + t * (pathFracs[activeIdx + 1] - pathFracs[activeIdx]);
    }

    // Also extend to end when fully scrolled
    const maxScroll = document.documentElement.scrollHeight - vh;
    if (maxScroll > 0 && scrollTop >= maxScroll - 10) {
      progress = 1;
    }

    const litLen = progress * totalLen;
    const darkLen = totalLen - litLen;

    pathGlow.style.strokeDasharray = `${litLen} ${darkLen}`;
    pathGlow.style.strokeDashoffset = "0";

    pathCore.style.strokeDasharray = `${litLen} ${darkLen}`;
    pathCore.style.strokeDashoffset = "0";

    // Activate dots cumulatively
    dotEls.forEach((dot, i) => {
      dot.classList.toggle("is-active", pathFracs[i] <= progress + 0.01);
    });
  }

  // ---- Handle resize ----
  function onResize() {
    const vh = window.innerHeight;
    const dotPositions = computeDotPositions(vh);
    const pathD = buildPath(dotPositions, vh);

    svgEl.setAttribute("viewBox", `0 0 220 ${vh}`);
    pathBg.setAttribute("d", pathD);
    pathGlow.setAttribute("d", pathD);
    pathCore.setAttribute("d", pathD);

    // Reposition dots
    dotEls.forEach((dot, i) => {
      dot.style.left = `${dotPositions[i].x}px`;
      dot.style.top = `${(dotPositions[i].y / vh) * 100}%`;
    });

    measure();
    updateGlow();
  }

  // ---- Init ----
  function init() {
    build();
    measure();
    updateGlow();

    window.addEventListener("scroll", updateGlow, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    requestAnimationFrame(() => {
      measure();
      updateGlow();
    });
  }

  return { init };
})();

window.initTracingBeam = TracingBeam.init;
