import {
  sessions, activeProject, loadedBefore, hasMoreHistory,
  isShareView, shareProject, currentShareUrl, publicOrigin,
  activeFilter, filterBar, filterCount,
  setIsShareView, setShareProject, setActiveProject,
  setPublicOrigin, setCurrentShareUrl, setLoadedBefore, setHasMoreHistory,
  setIsLoadingHistory, isLoadingHistory
} from './state.js';
import {
  renderList, appendMsg, addExpandButtons, applyFilter,
  showFilterBar, markActive, selectProject, createMsgEl
} from './render.js';
import { esc } from './utils.js';
import { handleDanmakuEvent, playbackHistory, loadDanmakuHistory } from './danmaku.js';

// --- SSE ---
export function getSSEUrl() {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  return '/events' + (t ? '?t=' + encodeURIComponent(t) : '');
}

export function connect() {
  const es = new EventSource(getSSEUrl());
  es.addEventListener('sessions', e => {
    JSON.parse(e.data).forEach(s => {
      if (!sessions.has(s.sessionId)) sessions.set(s.sessionId, {...s, messages:[]});
      else {
        const existing = sessions.get(s.sessionId);
        existing.messageCount = s.messageCount;
      }
    });
    renderList();
    if (activeProject) loadMessages();
  });
  es.addEventListener('session-new', e => {
    const s = JSON.parse(e.data);
    sessions.set(s.sessionId, {...s, messages:[]});
    renderList();
    if (activeProject === s.projectName) loadMessages();
  });
  es.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    const s = sessions.get(m.sessionId);
    if(!s) return;
    s.messages.push(m);
    if(s.messages.length>500) s.messages=s.messages.slice(-300);
    markActive(s.projectName);
    if(activeProject && s.projectName === activeProject) appendMsg(m);
  });
  es.addEventListener('share-info', e => {
    const info = JSON.parse(e.data);
    if (info.error) {
      document.getElementById('title').textContent = 'Access Denied';
      document.getElementById('msgs').innerHTML = '<div class="empty">No access. A valid share token is required.</div>';
      return;
    }
    setIsShareView(true);
    setShareProject(info.project);
    setActiveProject(info.project);
    document.getElementById('title').textContent = info.project;
    renderList();
    loadMessages();
    // Load danmaku history for all sessions in this project
    for (const [sid, s] of sessions) {
      if (s.projectName === info.project) {
        loadDanmakuHistory(sid).then(items => { if (items.length) playbackHistory(items); }).catch(() => {});
      }
    }
  });
  es.addEventListener('danmaku', e => {
    try { handleDanmakuEvent(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('viewer_count', e => {
    try { const { count } = JSON.parse(e.data); if (typeof count === 'number') document.getElementById('status').textContent = count === 1 ? 'Live · 1 viewing' : `Live · ${count} viewing`; } catch {}
  });
  es.addEventListener('public-origin', e => {
    try { setPublicOrigin(JSON.parse(e.data)); } catch { setPublicOrigin(e.data); }
  });
  es.onerror=()=>{document.getElementById('status').textContent='Reconnecting...';document.getElementById('dot').style.background='var(--red)'};
  es.onopen=()=>{document.getElementById('status').textContent='Live';document.getElementById('dot').style.background='var(--green)';renderList()};
}

// --- Messages API ---
export async function loadMessages() {
  showFilterBar();
  const el = document.getElementById('msgs');
  const isFirstPage = !loadedBefore;
  if (isFirstPage) el.innerHTML = '';
  const params = new URLSearchParams({project: activeProject, limit: 50});
  if (loadedBefore) params.set('before', loadedBefore);
  const urlParams = new URLSearchParams(window.location.search);
  const t = urlParams.get('t');
  if (t) params.set('t', t);
  try {
    setIsLoadingHistory(true);
    // Capture scroll state before any DOM changes
    const prevScrollTop = el.scrollTop;
    const prevHeight = el.scrollHeight;
    // Show loading indicator at top (absolute positioned, no layout shift)
    const existingIndicator = el.querySelector('.loading-indicator');
    if (!existingIndicator) {
      const indicator = document.createElement('div');
      indicator.className = 'loading-indicator';
      indicator.textContent = 'Loading...';
      el.insertBefore(indicator, el.firstChild);
    }
    const r = await fetch('/api/project-messages?' + params);
    const msgs = await r.json();
    // Remove loading indicator
    const indicator = el.querySelector('.loading-indicator');
    if (indicator) indicator.remove();
    if (!msgs.length) { setHasMoreHistory(false); if (!el.children.length || el.querySelector('.empty')) el.innerHTML = '<div class="empty">No messages yet</div>'; setIsLoadingHistory(false); return; }
    const existingEmpty = el.querySelector('.empty');
    if (existingEmpty) existingEmpty.remove();
    const fragment = document.createDocumentFragment();
    let lastSid = null;
    for (const m of msgs) {
      if (m._sid !== lastSid) {
        lastSid = m._sid;
        const div = document.createElement('div');
        div.className = 'session-divider';
        div.textContent = '--- session ' + m._sid.slice(0, 12) + '... ---';
        fragment.appendChild(div);
      }
      fragment.appendChild(createMsgEl(m));
    }
    const oldestTs = msgs[0].timestamp;
    el.insertBefore(fragment, el.firstChild);
    addExpandButtons(el);
    applyFilter();
    setLoadedBefore(oldestTs);
    if (msgs.length < 50) setHasMoreHistory(false);
    if (activeFilter !== 'all' && hasMoreHistory) {
      const hasMatch = msgs.some(m => (m.role || 'system') === activeFilter);
      if (!hasMatch) { setIsLoadingHistory(false); loadMessages(); return; }
    }
    if (isFirstPage) {
      const last = el.lastElementChild;
      if (last) {
        last.scrollIntoView({ block: 'end', behavior: 'instant' });
        el.scrollTop = el.scrollHeight;
      }
      const lastTs = msgs[msgs.length - 1].timestamp;
      if (lastTs && Date.now() - new Date(lastTs).getTime() < 120000) {
        markActive(activeProject);
      }
    } else {
      // Override smooth scrolling to ensure instant position restore
      el.style.scrollBehavior = 'auto';
      el.scrollTop = prevScrollTop + el.scrollHeight - prevHeight;
      el.style.scrollBehavior = '';
    }
  } catch { const indicator = el.querySelector('.loading-indicator'); if (indicator) indicator.remove(); setIsLoadingHistory(false); }
  setIsLoadingHistory(false);
}

// --- Share API ---
export async function createShare(project) {
  try {
    const r = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
    const data = await r.json();
    if (!r.ok) { alert('Error: ' + data.error); return; }
    const origin = publicOrigin || window.location.origin;
    setCurrentShareUrl(origin + data.url);
    document.getElementById('modalTitle').textContent = 'Share: ' + project;
    document.getElementById('modalBody').innerHTML = '<div class="hint">Share this URL to let others view this project\'s sessions:</div><div class="share-url" id="shareUrlText">' + esc(currentShareUrl) + '</div><div class="hint">The project name is not visible in the URL. Revoke at any time from the sidebar.</div>';
    document.getElementById('modal').style.display = 'flex';
  } catch (e) { alert('Failed to create share: ' + e.message); }
}

export function closeModal() { document.getElementById('modal').style.display = 'none'; }

export function copyShareUrl() {
  navigator.clipboard.writeText(currentShareUrl).then(() => {
    document.getElementById('modalCopyBtn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('modalCopyBtn').textContent = 'Copy URL'; }, 2000);
  });
}
