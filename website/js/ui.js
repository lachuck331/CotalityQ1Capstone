
// UI Components & Effects
// reusable interactions like mobile menu, smooth scroll, reveal, tilt, counters, magnets

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
    const handleScroll = function(e) {
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
    const maxTilt = 10;

    function applyTilt(el, e) {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const rx = (y - 0.5) * -maxTilt;
      const ry = (x - 0.5) * maxTilt;
      el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-1px)`;
    }

    if (!UI.reduce) {
      tilts.forEach(el => {
        // Clean up old listeners if re-initializing? 
        // For simplicity, we assume this is safe to call or called once per element.
        // A better approach for re-init (like after loading sections) is to distinguish initialized elements.
        // For now, we'll just overwrite.
        el.onpointermove = (e) => applyTilt(el, e);
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

      const duration = 900;
      const start = performance.now();
      const from = 0;

      function frame(now) {
        const t = Math.min(1, (now - start) / duration);
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
  },

  initMagnets() {
    const magnets = Array.from(document.querySelectorAll(".magnetic"));
    if (!UI.reduce) {
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
  },

  initYear() {
    const yearEl = document.getElementById("year");
    if (yearEl) yearEl.textContent = new Date().getFullYear();
  },

  initFloatingNav() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;

    function onScroll() {
      const y = window.scrollY;
      if (y > 100) {
        topbar.classList.add("is-floating");
      } else {
        topbar.classList.remove("is-floating");
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  },
  
  // Master init for all UI
  initAll() {
    this.initMobileMenu();
    this.initSmoothScroll();
    this.initMagnets();
    this.initYear();
    this.initFloatingNav();
    // These might be called again after content load
    this.initReveal();
    this.initTilt();
    this.initCounters();
  }
};

window.UI = UI;
