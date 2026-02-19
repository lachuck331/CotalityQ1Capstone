
// Main Application Entry
// Orchestrates section loading and initialization of modules

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

  // Load team data (using new module)
  if (window.Team) {
    await window.Team.init();
  }

  // Re-init interactive elements for new content (using new UI module)
  if (window.UI) {
    window.UI.initReveal();
    window.UI.initTilt();
    window.UI.initCounters(); // demoHeat counters
    window.UI.initMagnets(); // demo buttons
    window.UI.initSmoothScroll(); // demo back to top
  }

  // Init heatmap demo (if loaded)
  if (window.initDemo) window.initDemo();
}

// Main initialization
(() => {
  // Init global UI elements immediately
  if (window.UI) {
    window.UI.initAll();
  } else {
    console.warn("UI module not found");
  }

  // Load remaining sections
  loadAllSections();
})();
