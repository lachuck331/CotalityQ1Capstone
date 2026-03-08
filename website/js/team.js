
// Team Section Logic
// Handles fetching and rendering team member data from JSON

const TEAM_IMAGES_READY_FLAG = "__cotalityTeamImagesReady";
const TEAM_IMAGES_READY_EVENT = "cotality:team-images-ready";
const TEAM_IMAGES_PRESENT_FLAG = "__cotalityTeamImagesPresent";

const Team = {
  async init() {
    const grid = document.getElementById("team-grid");
    if (!grid) {
      globalThis[TEAM_IMAGES_PRESENT_FLAG] = false;
      globalThis[TEAM_IMAGES_READY_FLAG] = true;
      window.dispatchEvent(new CustomEvent(TEAM_IMAGES_READY_EVENT));
      return;
    }

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

      const imageUrls = data.map(person => person.image).filter(Boolean);
      globalThis[TEAM_IMAGES_PRESENT_FLAG] = imageUrls.length > 0;
      await Promise.all(imageUrls.map((url) => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = url;
        });
      }));
      
      // Re-initialize UI effects for new elements if UI is available
      if (window.UI) {
        window.UI.initTilt();
        window.UI.initReveal();
      }
      
      globalThis[TEAM_IMAGES_READY_FLAG] = true;
      window.dispatchEvent(new CustomEvent(TEAM_IMAGES_READY_EVENT));
      
    } catch (err) {
      console.warn("Team load error:", err);
      globalThis[TEAM_IMAGES_PRESENT_FLAG] = false;
      globalThis[TEAM_IMAGES_READY_FLAG] = true;
      window.dispatchEvent(new CustomEvent(TEAM_IMAGES_READY_EVENT));
    }
  }
};

window.Team = Team;
