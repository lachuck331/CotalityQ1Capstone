// Global UX polish:
// - cursor glow tracking
// - mobile menu
// - smooth scroll
// - reveal on scroll (IntersectionObserver)
// - tilt cards
// - animated counters
// - magnetic buttons
// - dynamic section loading

const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function initCursorGlow() {
  const glow = document.querySelector(".cursor-glow");
  if (glow) {
    let gx = -9999, gy = -9999;
    let tx = gx, ty = gy;

    function tick() {
      // ease toward target
      gx += (tx - gx) * 0.12;
      gy += (ty - gy) * 0.12;
      glow.style.transform = `translate3d(${gx - 260}px, ${gy - 260}px, 0)`;
      if (!reduce) requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", (e) => {
      tx = e.clientX;
      ty = e.clientY;
    }, { passive: true });

    if (!reduce) requestAnimationFrame(tick);
  }
}

function initMobileMenu() {
  const burger = document.getElementById("burger");
  const mobile = document.getElementById("mobile"); // If created dynamically? No, logic assumes existing structure.
  
  // Note: currently mobile menu markup doesn't exist in index.html (I recall seeing .mobile in CSS but maybe not HTML?)
  // Let's check index.html. Ah, mobile menu might be missing or hidden in CSS. 
  // Line 52 implies burger exists. Line 252 in CSS defines .mobile. 
  // Let's assume if it exists we bind it.
  if (burger && mobile) {
    burger.addEventListener("click", () => {
      const isOpen = burger.getAttribute("aria-expanded") === "true";
      burger.setAttribute("aria-expanded", String(!isOpen));
      mobile.hidden = isOpen;
    });

    mobile.querySelectorAll("a").forEach(a => {
      a.addEventListener("click", () => {
        burger.setAttribute("aria-expanded", "false");
        mobile.hidden = true;
      });
    });
  }
}

function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.removeEventListener("click", handleScroll); // cleanup just in case
    a.addEventListener("click", handleScroll);
  });
}

function handleScroll(e) {
  const id = this.getAttribute("href");
  if (!id || id.length < 2) return;
  const target = document.querySelector(id);
  if (!target) return;
  e.preventDefault();
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

function initReveal() {
  // Reveal on scroll
  const revealEls = Array.from(document.querySelectorAll(".reveal:not(.is-in)"));
  if (revealEls.length === 0) return;

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) {
          en.target.classList.add("is-in");
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("is-in"));
  }
}

function initTilt() {
  const tilts = Array.from(document.querySelectorAll(".tilt"));
  const maxTilt = 10;

  function applyTilt(el, e) {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;   // 0..1
    const y = (e.clientY - r.top) / r.height;   // 0..1
    const rx = (y - 0.5) * -maxTilt;
    const ry = (x - 0.5) * maxTilt;
    el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-1px)`;
  }

  if (!reduce) {
    tilts.forEach(el => {
      // Remove old listeners to avoid dupes? A bit tricky. 
      // Simplified: rely on clean init or just add listeners (browser handles dupes if same ref, but these are anon functions).
      // For safety, we can clone node or just rely on 'tilt' class being added freshly.
      // Since we just inject HTML, these are new elements. Old elements (hero) might get duped listeners if we re-run.
      // Fix: only query elements that don't have a marker?
      // Or simply: tilts are new elements from sections. Hero elements are already bound? 
      // Let's just re-bind everything. It's fine for this scale.
      el.onpointermove = (e) => applyTilt(el, e);
      el.onpointerleave = () => { el.style.transform = "none"; };
    });
  }
}

function initCounters() {
  const counters = Array.from(document.querySelectorAll(".counter"));
  
  function animateCounter(el) {
    if (el.dataset.animated) return; // avoid re-animating
    el.dataset.animated = "true";
    
    const to = parseFloat(el.dataset.to || "0");
    const decimals = parseInt(el.dataset.decimals || "0", 10);

    const duration = 900; // ms
    const start = performance.now();
    const from = 0;

    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      // ease out
      const eased = 1 - Math.pow(1 - t, 3);
      const v = from + (to - from) * eased;
      el.textContent = v.toFixed(decimals);

      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(en => {
        if (en.isIntersecting) {
          animateCounter(en.target);
          io.unobserve(en.target);
        }
      });
    }, { threshold: 0.6 });

    counters.forEach(c => io.observe(c));
  } else {
    counters.forEach(animateCounter);
  }
}

function initMagnets() {
  const magnets = Array.from(document.querySelectorAll(".magnetic"));
  if (!reduce) {
    magnets.forEach(btn => {
      const strength = 10;
      btn.onpointermove = (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate3d(${dx / r.width * strength}px, ${dy / r.height * strength}px, 0)`;
      };

      btn.onpointerleave = () => {
        btn.style.transform = "translate3d(0,0,0)";
      };
    });
  }
}

function initYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
}

async function loadSection(id, file) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Failed to load ${file}`);
    const html = await res.text();
    el.innerHTML = html;
  } catch (err) {
    console.warn(err);
  }
}

async function loadAllSections() {
  const sections = [
    { id: "about", file: "./sections/overview.html" },
    { id: "results", file: "./sections/results.html" },
    { id: "pipeline", file: "./sections/pipeline.html" },
    { id: "data", file: "./sections/data.html" },
    { id: "demo", file: "./sections/demo.html" },
    { id: "team", file: "./sections/team.html" },
  ];

  await Promise.all(sections.map(s => loadSection(s.id, s.file)));

  // Re-init interactive elements for new content
  initReveal();
  initTilt();
  initCounters(); // demoHeat counters
  initMagnets(); // demo buttons
  initSmoothScroll(); // demo back to top

  // Init heatmap demo (if loaded)
  if (window.initDemo) window.initDemo();
}


function initFloatingNav() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  function onScroll() {
    const y = window.scrollY;
    // Toggle class based on scroll position (e.g., 100px)
    if (y > 100) {
      topbar.classList.add("is-floating");
    } else {
      topbar.classList.remove("is-floating");
    }
  }

  // Throttle or use rAF if needed, but simple listener is usually fine for just a class toggle
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll(); // initial check
}

// Main initialization
(() => {
  initCursorGlow();
  initMobileMenu();
  initSmoothScroll();
  initMagnets();
  initYear();
  initFloatingNav();

  // Load remaining sections
  loadAllSections();
})();
