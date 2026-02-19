
// Team Section Logic
// Handles fetching and rendering team member data from JSON

const Team = {
  async init() {
    const grid = document.getElementById("team-grid");
    if (!grid) return;

    try {
      const res = await fetch("./data/team.json");
      if (!res.ok) throw new Error("Failed to load team data");
      const data = await res.json();

      const html = data.map(person => `
        <article class="person tilt reveal">
          <div class="avatar" aria-hidden="true" style="background-image: url('${person.image || ''}'); background-size: cover; background-position: center;"></div>
          <div class="person__name">${person.name}</div>
          <div class="person__role">${person.role}</div>
          <div class="person__links">
            <a href="mailto:${person.email}" aria-label="${person.email}">${person.email}</a>
          </div>
        </article>
      `).join('');

      grid.innerHTML = html;
      
      // Re-initialize UI effects for new elements if UI is available
      if (window.UI) {
        window.UI.initTilt();
        window.UI.initReveal();
      }
      
    } catch (err) {
      console.warn("Team load error:", err);
    }
  }
};

window.Team = Team;
