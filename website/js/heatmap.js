// Canvas heatmap demo (stylized California-ish field)
// - One for hero preview (#heroHeat) and one interactive (#demoHeat)
// - Interactive supports: time slider + hover tooltip
// - Replace generator with real data later (just feed a Float32Array per timestep)

(() => {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -------- Utilities --------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  function colorRamp(t) {
    // t in [0,1] -> RGB. Mint -> blue -> magenta -> warm.
    t = clamp(t, 0, 1);
    const stops = [
      { t: 0.00, c: [183, 255, 240] },
      { t: 0.35, c: [138, 167, 255] },
      { t: 0.68, c: [255, 107, 214] },
      { t: 1.00, c: [255, 184, 107] },
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1];
      if (t >= a.t && t <= b.t) {
        const u = (t - a.t) / (b.t - a.t);
        const r = Math.round(lerp(a.c[0], b.c[0], u));
        const g = Math.round(lerp(a.c[1], b.c[1], u));
        const bl = Math.round(lerp(a.c[2], b.c[2], u));
        return [r, g, bl];
      }
    }
    return stops[stops.length - 1].c;
  }

  // Simple deterministic noise using sine hashing
  function noise2D(x, y, seed) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }

  function makeField(cols, rows, tIndex) {
    // Generates a stylized "risk surface" that changes over time.
    // Replace this with real prediction grids later.
    const out = new Float32Array(cols * rows);
    const seed = 0.12 + tIndex * 0.01;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        // normalized coords
        const nx = (x / (cols - 1)) * 2 - 1;
        const ny = (y / (rows - 1)) * 2 - 1;

        // "California-ish" mask: a slanted coastal boundary + top cutoff
        // This is *not* geographic — it's a stylized silhouette for demo.
        const coast = nx * 0.55 + 0.20;
        const inland = nx * 0.65 + 0.55;
        const topCut = ny < -0.85 ? 0 : 1;
        const mask = (ny > coast && ny < inland && topCut) ? 1 : 0;

        // risk signal: blob + seasonal shift + noise
        const blob1 = Math.exp(-((nx + 0.1) ** 2 / 0.22 + (ny - 0.05) ** 2 / 0.18));
        const blob2 = Math.exp(-((nx - 0.25) ** 2 / 0.12 + (ny + 0.15) ** 2 / 0.10));
        const season = 0.55 + 0.35 * Math.sin((tIndex / 12) * Math.PI * 2);
        const n = noise2D(x * 0.9, y * 0.9, seed);

        let v = (0.55 * blob1 + 0.85 * blob2) * season + 0.25 * n;
        v = clamp(v, 0, 1);

        // exaggerate contrast for visual pop
        v = Math.pow(v, 1.35);

        out[y * cols + x] = v * mask;
      }
    }
    return out;
  }

  function drawHeat(ctx, w, h, cols, rows, field, options = {}) {
    const { vignette = true, grid = true, highlight = null } = options;

    // render to ImageData for crisp pixels
    const img = ctx.createImageData(cols, rows);
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      const idx = i * 4;

      if (v <= 0) {
        img.data[idx + 0] = 0;
        img.data[idx + 1] = 0;
        img.data[idx + 2] = 0;
        img.data[idx + 3] = 0;
        continue;
      }

      const [r, g, b] = colorRamp(v);
      img.data[idx + 0] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = Math.round(lerp(30, 210, v));
    }

    // paint scaled
    const off = document.createElement("canvas");
    off.width = cols;
    off.height = rows;
    const octx = off.getContext("2d");
    octx.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, w, h);

    // background
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, w, h);

    // scaled field (nearest-neighbor for crisp cells)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, w, h);

    // subtle grid overlay
    if (grid) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;

      const cw = w / cols;
      const ch = h / rows;

      // draw fewer lines for performance
      for (let x = 0; x <= cols; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x * cw, 0);
        ctx.lineTo(x * cw, h);
        ctx.stroke();
      }
      for (let y = 0; y <= rows; y += 6) {
        ctx.beginPath();
        ctx.moveTo(0, y * ch);
        ctx.lineTo(w, y * ch);
        ctx.stroke();
      }
      ctx.restore();
    }

    // vignette
    if (vignette) {
      const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.45, Math.max(w, h) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.52)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // highlight hovered cell
    if (highlight) {
      const { cx, cy } = highlight;
      const cw = w / cols;
      const ch = h / rows;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.strokeRect(cx * cw + 0.5, cy * ch + 0.5, cw, ch);

      ctx.globalAlpha = 0.28;
      ctx.fillStyle = "rgba(183,255,240,0.35)";
      ctx.fillRect(cx * cw, cy * ch, cw, ch);
      ctx.restore();
    }
  }

  function monthLabel(index, startYear = 2000) {
    // index 0 => Jan 2000
    const y = startYear + Math.floor(index / 12);
    const m = index % 12;
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[m]} ${y}`;
  }

  // -------- Hero heat preview --------
  function initHero() {
    const c = document.getElementById("heroHeat");
    if (!c) return;
    const ctx = c.getContext("2d");

    // density tuned for hero
    const cols = 130;
    const rows = 90;

    let t = 180;
    let field = makeField(cols, rows, t);

    function render() {
      drawHeat(ctx, c.width, c.height, cols, rows, field, { vignette: true, grid: true });
    }

    render();

    // parallax effect on hover
    let px = 0, py = 0;
    const maxTilt = 6;

    const parent = c.closest(".viz");
    if (parent) {
      parent.addEventListener("pointermove", (e) => {
        const r = parent.getBoundingClientRect();
        const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
        const ny = ((e.clientY - r.top) / r.height) * 2 - 1;

        px = nx; py = ny;
        parent.style.transform = `perspective(900px) rotateY(${nx * maxTilt}deg) rotateX(${-ny * maxTilt}deg) translateY(-1px)`;
      }, { passive: true });

      parent.addEventListener("pointerleave", () => {
        parent.style.transform = "none";
      });
    }

    // subtle time drift
    if (!reduce) {
      let last = performance.now();
      function tick(now) {
        const dt = now - last;
        last = now;
        if (dt > 0) {
          // advance slowly
          t += 0.015 * dt;
          const ti = Math.floor(t) % 300;
          field = makeField(cols, rows, ti);
          render();
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    }
  }

  // -------- Interactive demo --------
  function initDemo() {
    const c = document.getElementById("demoHeat");
    const slider = document.getElementById("t");
    if (!c || !slider) return;

    const ctx = c.getContext("2d");

    const tooltip = document.getElementById("tooltip");
    const timeLabelEl = document.getElementById("timeLabel");
    const hoverLabelEl = document.getElementById("hoverLabel");
    const probLabelEl = document.getElementById("probLabel");

    const cols = 160;
    const rows = 92;

    let tIndex = parseInt(slider.value, 10) || 180;
    let field = makeField(cols, rows, tIndex);

    let hover = null; // {cx, cy}
    let lastPointer = { x: 0, y: 0 };

    function render() {
      drawHeat(ctx, c.width, c.height, cols, rows, field, { vignette: true, grid: true, highlight: hover });
      timeLabelEl.textContent = monthLabel(tIndex, 2000);
    }

    function cellFromPointer(e) {
      const r = c.getBoundingClientRect();
      const x = clamp(e.clientX - r.left, 0, r.width);
      const y = clamp(e.clientY - r.top, 0, r.height);
      const cx = clamp(Math.floor((x / r.width) * cols), 0, cols - 1);
      const cy = clamp(Math.floor((y / r.height) * rows), 0, rows - 1);
      return { cx, cy, x, y, r };
    }

    function updateHover(e) {
      const p = cellFromPointer(e);
      lastPointer = { x: e.clientX, y: e.clientY };

      const v = field[p.cy * cols + p.cx];
      if (v <= 0) {
        hover = null;
        if (tooltip) tooltip.hidden = true;
        hoverLabelEl.textContent = "—";
        probLabelEl.textContent = "—";
        render();
        return;
      }

      hover = { cx: p.cx, cy: p.cy };

      hoverLabelEl.textContent = `(${p.cx}, ${p.cy})`;
      probLabelEl.textContent = v.toFixed(3);

      if (tooltip) {
        tooltip.hidden = false;
        tooltip.textContent = `Cell (${p.cx}, ${p.cy}) • p = ${v.toFixed(3)} • ${monthLabel(tIndex, 2000)}`;
        // position tooltip near pointer but inside panel
        const panel = c.parentElement.getBoundingClientRect();
        const tx = clamp(e.clientX - panel.left + 14, 14, panel.width - 280);
        const ty = clamp(e.clientY - panel.top + 14, 14, panel.height - 60);
        tooltip.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      }

      render();
    }

    slider.addEventListener("input", () => {
      tIndex = parseInt(slider.value, 10) || 0;
      field = makeField(cols, rows, tIndex);
      render();
      if (hover) {
        // refresh tooltip
        const v = field[hover.cy * cols + hover.cx];
        if (v > 0 && tooltip && !tooltip.hidden) {
          tooltip.textContent = `Cell (${hover.cx}, ${hover.cy}) • p = ${v.toFixed(3)} • ${monthLabel(tIndex, 2000)}`;
          probLabelEl.textContent = v.toFixed(3);
        }
      }
    });

    c.addEventListener("pointermove", updateHover, { passive: true });
    c.addEventListener("pointerleave", () => {
      hover = null;
      if (tooltip) tooltip.hidden = true;
      hoverLabelEl.textContent = "—";
      probLabelEl.textContent = "—";
      render();
    });

    // initial render
    render();
  }

  // boot
  initHero();
  window.initDemo = initDemo;
})();
