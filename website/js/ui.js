
// UI Components & Effects
// Theme toggle, smooth scroll, reveal animations, tilt, counters

const UI = {
  reduce: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches,

  initMobileMenu() {
    const burger = document.getElementById("burger");
    const mobile = document.getElementById("mobile");
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
  },

  initSmoothScroll() {
    const handleScroll = function (e) {
      const id = this.getAttribute("href");
      if (!id || id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: UI.reduce ? "auto" : "smooth", block: "start" });
    };
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.removeEventListener("click", handleScroll);
      a.addEventListener("click", handleScroll);
    });
  },

  initReveal() {
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
  },

  initTilt() {
    const tilts = Array.from(document.querySelectorAll(".tilt"));
    const maxTilt = 4;
    if (!UI.reduce) {
      tilts.forEach(el => {
        el.onpointermove = (e) => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width;
          const y = (e.clientY - r.top) / r.height;
          el.style.transform = `perspective(800px) rotateX(${(y - 0.5) * -maxTilt}deg) rotateY(${(x - 0.5) * maxTilt}deg)`;
        };
        el.onpointerleave = () => { el.style.transform = "none"; };
      });
    }
  },

  initCounters() {
    const counters = Array.from(document.querySelectorAll(".counter"));
    function animateCounter(el) {
      if (el.dataset.animated) return;
      el.dataset.animated = "true";
      const to = parseFloat(el.dataset.to || "0");
      const decimals = parseInt(el.dataset.decimals || "0", 10);
      const duration = 800;
      const start = performance.now();
      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = (to * eased).toFixed(decimals);
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (en.isIntersecting) { animateCounter(en.target); io.unobserve(en.target); }
        });
      }, { threshold: 0.6 });
      counters.forEach(c => io.observe(c));
    } else {
      counters.forEach(animateCounter);
    }
  },

  // SVG icons for theme toggle
  _themeIcons: {
    system: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
    dark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>'
  },

  initThemeToggle() {
    const btn = document.getElementById("themeToggle");
    if (!btn) return;

    const THEMES = ["system", "light", "dark"];
    let current = localStorage.getItem("theme") || "system";
    if (!THEMES.includes(current)) current = "system";

    const applyTheme = (theme) => {
      const html = document.documentElement;
      if (theme === "system") {
        html.removeAttribute("data-theme");
      } else {
        html.setAttribute("data-theme", theme);
      }
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) {
        const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
        meta.content = isDark ? "#262626" : "#ffffff";
      }
      btn.innerHTML = this._themeIcons[theme];
      btn.setAttribute("aria-label", `Theme: ${theme}`);
    };

    applyTheme(current);

    btn.addEventListener("click", () => {
      const idx = THEMES.indexOf(current);
      current = THEMES[(idx + 1) % THEMES.length];
      localStorage.setItem("theme", current);
      applyTheme(current);
    });

    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (current === "system") applyTheme("system");
    });
  },

  initYear() {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  },

  initFloatingNav() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const onScroll = () => {
      topbar.classList.toggle("is-floating", window.scrollY > 50);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  },

  initAll() {
    this.initMobileMenu();
    this.initSmoothScroll();
    this.initThemeToggle();
    this.initYear();
    this.initFloatingNav();
    this.initReveal();
    this.initTilt();
    this.initCounters();
  }
};

window.UI = UI;
