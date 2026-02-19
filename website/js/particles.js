// Ambient particle field (performance-friendly)
// - soft lines + dots
// - respects prefers-reduced-motion (disables animation)

(() => {
  const canvas = document.getElementById("particles");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let w = 0, h = 0, dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const pts = [];
  const N = 90;

  function resize() {
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function init() {
    pts.length = 0;
    for (let i = 0; i < N; i++) {
      pts.push({
        x: rand(0, w),
        y: rand(0, h),
        vx: rand(-0.35, 0.35),
        vy: rand(-0.25, 0.25),
        r: rand(1.0, 2.2),
        a: rand(0.08, 0.22),
      });
    }
  }

  function step() {
    ctx.clearRect(0, 0, w, h);

    // subtle fade
    ctx.fillStyle = "rgba(5, 6, 10, 0.05)";
    ctx.fillRect(0, 0, w, h);

    // dots + lines
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      p.x += p.vx;
      p.y += p.vy;

      if (p.x < -30) p.x = w + 30;
      if (p.x > w + 30) p.x = -30;
      if (p.y < -30) p.y = h + 30;
      if (p.y > h + 30) p.y = -30;

      // dot
      ctx.beginPath();
      ctx.fillStyle = `rgba(255,255,255,${p.a})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // lines
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i], b = pts[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 120) {
          const alpha = (1 - dist / 120) * 0.10;
          ctx.strokeStyle = `rgba(183,255,240,${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    if (!reduce) requestAnimationFrame(step);
  }

  resize();
  init();
  if (!reduce) step();
  else {
    // one frame if reduced motion
    ctx.clearRect(0, 0, w, h);
    step();
  }

  window.addEventListener("resize", () => {
    resize();
    init();
  }, { passive: true });
})();
