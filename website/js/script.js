
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
  const showResultsExplorer = !window.matchMedia("(max-width: 768px)").matches;
  const sections = [
    { id: "introduction", file: "./sections/introduction.html" },
    { id: "pipeline", file: "./sections/pipeline.html" },
    { id: "methodology", file: "./sections/methodology.html" },
    { id: "results", file: "./sections/results.html" },
    { id: "limitations", file: "./sections/limitations.html" },
    { id: "nav", file: "./sections/nav.html" },
    { id: "hero", file: "./sections/hero.html" },
    { id: "team", file: "./sections/team.html" },
  ];

  await Promise.all(sections.map(s => loadSection(s.id, s.file)));
  if (showResultsExplorer) {
    await loadSection("resultsDemoHost", "./sections/demo.html");
  }

  if (window.Team) await window.Team.init();

  if (window.UI) {
    window.UI.initAll(); // Initialize everything (theme, nav, reveal, etc.) AFTER elements are loaded
  }

  if (window.initTracingBeam) window.initTracingBeam();

  if (window.initPipelineViz) window.initPipelineViz();
  if (window.initFeatureImportanceViz) window.initFeatureImportanceViz();
  if (showResultsExplorer && window.initDemo) window.initDemo();
}

(() => {
  loadAllSections();
})();
