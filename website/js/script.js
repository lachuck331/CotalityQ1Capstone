
// Main Application Entry

async function loadSection(id, file) {
  const el = document.getElementById(id);
  if (!el) return;
  try {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`Failed to load ${file}`);
    el.innerHTML = await res.text();
  } catch (err) {
    console.warn(err);
  }
}

async function loadAllSections() {
  const sections = [
    // Uncomment to display:
    { id: "about", file: "./sections/overview.html" },
    { id: "results", file: "./sections/results.html" },
    { id: "pipeline", file: "./sections/pipeline.html" },
    { id: "data", file: "./sections/data.html" },
    { id: "nav", file: "./sections/nav.html" },
    { id: "hero", file: "./sections/hero.html" },
    { id: "demo", file: "./sections/demo.html" },
    { id: "team", file: "./sections/team.html" },
  ];

  await Promise.all(sections.map(s => loadSection(s.id, s.file)));

  if (window.Team) await window.Team.init();

  if (window.UI) {
    window.UI.initAll(); // Initialize everything (theme, nav, reveal, etc.) AFTER elements are loaded
  }

  if (window.initDemo) window.initDemo();
}

(() => {
  loadAllSections();
})();
