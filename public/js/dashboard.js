import { activeProject } from './state.js';

// ── State ──
let panelEl = null;
let isOpen = false;
let updateTimer = null;

// ── Init ──
export function initDashboard() {
  panelEl = document.getElementById('dashboard');
  const btn = document.getElementById('dashboardToggle');
  if (!panelEl || !btn) return;

  btn.addEventListener('click', () => {
    isOpen = !isOpen;
    panelEl.classList.toggle('open', isOpen);
    btn.classList.toggle('active', isOpen);
    if (isOpen) {
      updateDashboard();
      startAutoUpdate();
    } else {
      stopAutoUpdate();
    }
  });
}

export async function updateDashboard() {
  if (!panelEl || !isOpen || !activeProject) return;

  try {
    const params = new URLSearchParams({ project: activeProject });
    const t = new URLSearchParams(window.location.search).get('t');
    if (t) params.set('t', t);
    const r = await fetch('/api/project-stats?' + params);
    const stats = await r.json();
    if (!stats.totalMessages) {
      panelEl.querySelector('.dash-inner').innerHTML = '<div class="dash-empty">No data yet</div>';
      return;
    }
    render(stats);
  } catch {}
}

// ── Auto-update every 5s ──
function startAutoUpdate() {
  stopAutoUpdate();
  updateTimer = setInterval(updateDashboard, 5000);
}

function stopAutoUpdate() {
  if (updateTimer) { clearInterval(updateTimer); updateTimer = null; }
}

// ── Render ──
function render(s) {
  const inner = panelEl.querySelector('.dash-inner');
  if (!inner) return;

  inner.innerHTML =
    '<div class="dash-row">' +
      renderVelocity(s) +
      renderOverview(s) +
    '</div>' +
    '<div class="dash-row">' +
      renderTimeline(s) +
      renderTools(s) +
    '</div>';
}

function renderVelocity(s) {
  const color = s.velocity >= 5 ? 'var(--green)' : s.velocity >= 1 ? 'var(--yellow)' : 'var(--dim)';
  const label = s.velocity >= 5 ? 'Active' : s.velocity >= 1 ? 'Slow' : 'Idle';
  return '<div class="dash-card dash-velocity">' +
    '<div class="dash-card-title">Velocity</div>' +
    '<div class="dash-velocity-num" style="color:' + color + '">' + s.velocity + '</div>' +
    '<div class="dash-velocity-label" style="color:' + color + '">' + label + '</div>' +
    '<div class="dash-velocity-sub">msgs/min</div>' +
  '</div>';
}

function renderOverview(s) {
  return '<div class="dash-card dash-overview">' +
    '<div class="dash-card-title">Session Overview</div>' +
    '<div class="dash-stats">' +
      dashStat('Messages', s.totalMessages) +
      dashStat('Tool Calls', s.totalToolCalls) +
      dashStat('Files', s.filesTouched) +
      dashStat('Thinking', s.thinkingCount) +
      dashStat('Duration', formatDuration(s.durationMs)) +
      (s.model ? dashStat('Model', formatModel(s.model)) : '') +
    '</div>' +
  '</div>';
}

function dashStat(label, value) {
  return '<div class="dash-stat"><div class="dash-stat-val">' + value + '</div><div class="dash-stat-lbl">' + label + '</div></div>';
}

function renderTimeline(s) {
  const max = Math.max(1, ...s.timeline);
  let bars = '';
  for (let i = 0; i < 30; i++) {
    const h = Math.max(2, Math.round((s.timeline[i] / max) * 60));
    const toolH = Math.max(0, Math.round((s.timelineTools[i] / max) * 60));
    const title = (29 - i) + 'm ago: ' + s.timeline[i] + ' msgs';
    bars += '<div class="dash-tl-bar" style="height:' + h + 'px" title="' + title + '">' +
      (toolH > 0 ? '<div class="dash-tl-tool" style="height:' + toolH + 'px"></div>' : '') +
    '</div>';
  }
  return '<div class="dash-card dash-timeline">' +
    '<div class="dash-card-title">Activity <span class="dash-tl-range">Last 30 min</span></div>' +
    '<div class="dash-tl-chart">' + bars + '</div>' +
  '</div>';
}

function renderTools(s) {
  if (!s.topTools || !s.topTools.length) {
    return '<div class="dash-card dash-tools"><div class="dash-card-title">Tool Distribution</div><div class="dash-empty">No tool calls yet</div></div>';
  }
  let rows = '';
  for (const [name, count] of s.topTools) {
    const pct = Math.round((count / s.topToolMax) * 100);
    rows += '<div class="dash-tool-row">' +
      '<div class="dash-tool-name">' + esc(name) + '</div>' +
      '<div class="dash-tool-bar-wrap"><div class="dash-tool-bar" style="width:' + pct + '%"></div></div>' +
      '<div class="dash-tool-count">' + count + '</div>' +
    '</div>';
  }
  return '<div class="dash-card dash-tools">' +
    '<div class="dash-card-title">Tool Distribution</div>' +
    '<div class="dash-tool-list">' + rows + '</div>' +
  '</div>';
}

// ── Helpers ──
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDuration(ms) {
  if (ms <= 0) return '0m';
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return hrs + 'h ' + (mins % 60) + 'm';
  return mins + 'm';
}

function formatModel(m) {
  return m.replace(/^claude-/, '').replace(/-\d{8}$/, '');
}
