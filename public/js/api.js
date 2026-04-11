import {
  sessions, activeProject, loadedBefore, hasMoreHistory,
  isShareView, shareProject, shareToken, currentShareUrl, publicOrigin,
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
import { updateDashboard } from './dashboard.js';

function updateShareMsgCount() {
  if (!isShareView) return;
  const el = document.getElementById('shareMsgCount');
  if (!el) return;
  const msgEls = document.querySelectorAll('#msgs .msg');
  const visible = [...msgEls].filter(m => m.style.display !== 'none').length;
  el.textContent = visible + (visible === 1 ? ' msg' : ' msgs');
}


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
    s.messageCount = (s.messageCount || 0) + 1;
    if(s.messages.length>500) s.messages=s.messages.slice(-300);
    markActive(s.projectName);
    if(activeProject && s.projectName === activeProject) { appendMsg(m); updateDashboard(); updateShareMsgCount(); }
  });
  es.addEventListener('share-info', e => {
    const info = JSON.parse(e.data);
    if (info.error) {
      document.getElementById('title').textContent = 'Access Denied';
      document.getElementById('msgs').innerHTML = '<div class="empty">No access. A valid share token is required.</div>';
      return;
    }
    setIsShareView(true);
    document.querySelector('.app').classList.add('share-view');
    setShareProject(info.project);
    setActiveProject(info.project);
    document.getElementById('title').textContent = info.project;
    renderList();
    loadMessages();
    // Load danmaku history for this project
    loadDanmakuHistory(info.project).then(items => { if (items.length) playbackHistory(items); }).catch(() => {});
  });
  es.addEventListener('password-required', e => {
    es.close();
    const data = JSON.parse(e.data);
    showPasswordGate(data.token);
  });
  es.addEventListener('danmaku', e => {
    try { handleDanmakuEvent(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('viewer_count', e => {
    try {
      const { count } = JSON.parse(e.data);
      if (typeof count === 'number') {
        const text = count === 1 ? 'Live · 1 viewing' : `Live · ${count} viewing`;
        document.getElementById('status').textContent = text;
        const ss = document.getElementById('shareStatus');
        if (ss) ss.textContent = text;
      }
    } catch {}
  });
  es.addEventListener('public-origin', e => {
    try { setPublicOrigin(JSON.parse(e.data)); } catch { setPublicOrigin(e.data); }
  });
  es.onerror=()=>{
    document.getElementById('status').textContent='Reconnecting...';
    document.getElementById('dot').style.background='var(--red)';
    const ss=document.getElementById('shareStatus'),sd=document.getElementById('shareDot');
    if(ss)ss.textContent='Reconnecting...';
    if(sd)sd.style.background='var(--red)';
  };
  es.onopen=()=>{
    document.getElementById('status').textContent='Live';
    document.getElementById('dot').style.background='var(--green)';
    const ss=document.getElementById('shareStatus'),sd=document.getElementById('shareDot');
    if(ss)ss.textContent='Live';
    if(sd)sd.style.background='var(--green)';
    renderList();
  };
}

// --- Messages API ---
export async function loadMessages() {
  // showFilterBar();
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
    if (!r.ok && r.status === 401 && isShareView) {
      // Cookie lost or invalid — re-show password gate
      const indicator = el.querySelector('.loading-indicator');
      if (indicator) indicator.remove();
      const params2 = new URLSearchParams(window.location.search);
      const t2 = params2.get('t');
      if (t2) showPasswordGate(t2);
      setIsLoadingHistory(false);
      return;
    }
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
  updateDashboard();
  updateShareMsgCount();
}

// --- Share API ---
function generateRandomPassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let pwd = '';
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 6; i++) pwd += chars[arr[i] % chars.length];
  return pwd;
}

export async function createShare(project) {
  // Show pre-creation modal with password
  const randomPwd = generateRandomPassword();
  document.getElementById('modalTitle').textContent = 'Share: ' + project;
  document.getElementById('modalBody').innerHTML =
    '<div class="hint">Set a password for this share link. Viewers will need to enter it before accessing the content.</div>' +
    '<div class="share-password-row">' +
      '<input type="text" id="sharePasswordInput" value="' + esc(randomPwd) + '" maxlength="20" spellcheck="false">' +
      '<button type="button" class="share-password-toggle" id="sharePwdToggle" title="Show/Hide">👁</button>' +
    '</div>' +
    '<div class="btn-row" style="margin-top:16px">' +
      '<button type="button" id="modalCloseBtn">Cancel</button>' +
      '<button type="button" id="shareCreateBtn" class="primary">Create Share</button>' +
    '</div>';
  document.getElementById('modal').style.display = 'flex';

  // Toggle password visibility
  const pwdInput = document.getElementById('sharePasswordInput');
  document.getElementById('sharePwdToggle').addEventListener('click', () => {
    pwdInput.type = pwdInput.type === 'text' ? 'password' : 'text';
  });

  // Cancel
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);

  // Create
  document.getElementById('shareCreateBtn').addEventListener('click', async () => {
    const password = pwdInput.value.trim();
    if (!password) { pwdInput.style.borderColor = '#e74c3c'; return; }
    try {
      const r = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project, password }) });
      const data = await r.json();
      if (!r.ok) { alert('Error: ' + data.error); return; }
      const origin = publicOrigin || window.location.origin;
      setCurrentShareUrl(origin + data.url);
      // Show result modal
      document.getElementById('modalTitle').textContent = 'Share Created';
      document.getElementById('modalBody').innerHTML =
        '<div class="hint">Share this URL and password to let others view this project:</div>' +
        '<div class="share-url" id="shareUrlText">' + esc(currentShareUrl) + '</div>' +
        '<div class="share-pwd-display">' +
          '<div class="label">Password</div>' +
          '<div class="value">' + esc(data.password) + '</div>' +
        '</div>' +
        '<div class="hint">The project name is not visible in the URL. Revoke at any time from the sidebar.</div>';
      // Update button row
      const btnRow = document.getElementById('modalBody').parentElement.querySelector('.btn-row');
      if (btnRow) btnRow.remove();
      // Re-add the standard buttons
      const newBtnRow = document.createElement('div');
      newBtnRow.className = 'btn-row';
      newBtnRow.innerHTML = '<button type="button" id="modalCloseBtn">Close</button><button type="button" id="modalCopyBtn" class="primary">Copy URL</button>';
      document.getElementById('modal').querySelector('.modal').appendChild(newBtnRow);
      document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
      document.getElementById('modalCopyBtn').addEventListener('click', copyShareUrl);
    } catch (e) { alert('Failed to create share: ' + e.message); }
  });
}

export function closeModal() { document.getElementById('modal').style.display = 'none'; }

export function copyShareUrl() {
  navigator.clipboard.writeText(currentShareUrl).then(() => {
    const btn = document.getElementById('modalCopyBtn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy URL'; }, 2000); }
  });
}

export function showPasswordGate(token) {
  const gate = document.getElementById('passwordGate');
  const input = document.getElementById('passwordInput');
  const error = document.getElementById('passwordError');
  const submit = document.getElementById('passwordSubmit');
  gate.style.display = 'flex';
  input.value = '';
  error.style.display = 'none';
  input.focus();

  submit.onclick = async () => {
    const pwd = input.value.trim();
    if (!pwd) { input.style.borderColor = '#e74c3c'; return; }
    error.style.display = 'none';
    submit.textContent = 'Verifying...';
    submit.disabled = true;
    try {
      const r = await fetch('/api/shares/' + token + '/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd })
      });
      const data = await r.json();
      if (!r.ok) {
        error.textContent = data.error || 'Wrong password';
        error.style.display = 'block';
        input.style.borderColor = '#e74c3c';
        submit.textContent = 'Unlock';
        submit.disabled = false;
        input.select();
        return;
      }
      // Success — reload page to reconnect SSE with cookie
      window.location.reload();
    } catch (e) {
      error.textContent = 'Network error';
      error.style.display = 'block';
      submit.textContent = 'Unlock';
      submit.disabled = false;
    }
  };

  input.onkeydown = e => {
    if (e.key === 'Enter') submit.click();
    input.style.borderColor = '';
  };
}
