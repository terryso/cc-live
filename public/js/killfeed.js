// ── Kill Feed UI ─────────────────────────────────────────

const MAX_VISIBLE = 3;
const DISPLAY_MS = 4000;
const container = document.getElementById("kill-feed");

export function showKillFeed(event) {
  if (!container || !event) return;
  const item = document.createElement("div");
  item.className = "kf-item";
  item.innerHTML = `<span class="kf-icon">${event.icon}</span> <span class="kf-text">${_esc(event.text)}</span>`;
  container.appendChild(item);

  // Trim oldest if over limit
  while (container.children.length > MAX_VISIBLE) {
    container.firstChild.remove();
  }

  // Auto-remove after display duration
  setTimeout(() => {
    item.classList.add("kf-out");
    item.addEventListener("animationend", () => item.remove());
  }, DISPLAY_MS);
}

function _esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
