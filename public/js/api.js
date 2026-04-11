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
  showFilterBar, markActive, selectProject, createMsgEl, updateShareStatus
} from './render.js';
import { esc } from './utils.js';
import { handleDanmakuEvent, playbackHistory, loadDanmakuHistory } from './danmaku.js';
import { updateDashboard } from './dashboard.js';

let _shareModel = null;

// Persist share passwords locally so creator can always see them
function getSharePasswords() {
  try { return JSON.parse(localStorage.getItem('cc-share-pwds') || '{}'); } catch { return {}; }
}
function saveSharePassword(token, password) {
  const map = getSharePasswords();
  map[token] = password;
  localStorage.setItem('cc-share-pwds', JSON.stringify(map));
}

function _showShareDetails() {
  const ve = document.getElementById('shareViewers');
  const ms = document.getElementById('shareMsgSep');
  const mc = document.getElementById('shareMsgCount');
  // Only show msg count when both viewer data and msg content are ready
  if (ve && ve.style.display !== 'none' && mc && mc.textContent) {
    if (ms) ms.style.display = '';
    if (mc) mc.style.display = '';
  }
}

function updateShareMsgCount() {
  if (!isShareView || !activeProject) return;
  const el = document.getElementById('shareMsgCount');
  if (!el) return;
  let total = 0;
  for (const [, s] of sessions) {
    if (s.projectName === activeProject && !s.isSubagent) {
      total += s.messageCount || s.messages.length;
    }
  }
  if (total === 0) {
    total = document.querySelectorAll('#msgs .msg').length;
  }
  if (total > 0) {
    el.textContent = total + (total === 1 ? ' msg' : ' msgs');
  }
  _showShareDetails();
}

function updateShareModelDisplay() {
  if (!isShareView) return;
  const el = document.getElementById('shareModel');
  const sep = document.getElementById('shareModelSep');
  if (!el) return;
  if (_shareModel) {
    el.textContent = _shareModel;
    el.style.display = '';
    if (sep) sep.style.display = '';
  }
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
    updateShareMsgCount();
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
    if(m.display && m.display.model) _shareModel = m.display.model;
    if(activeProject && s.projectName === activeProject) { appendMsg(m); updateDashboard(); updateShareMsgCount(); updateShareModelDisplay(); }
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
        const ve = document.getElementById('shareViewers');
        const vs = document.getElementById('shareViewerSep');
        if (ve) {
          ve.textContent = count === 1 ? '1 viewing' : `${count} viewing`;
          ve.style.display = '';
          if (vs) vs.style.display = '';
        }
        _showShareDetails();
        // Mobile: show viewer count in status text since individual elements are hidden
        if (isShareView && window.innerWidth <= 768) {
          const ss = document.getElementById('shareStatus');
          const live = _devTimers.has(activeProject);
          const statusText = live ? '直播中' : '空闲';
          ss.textContent = statusText + ' · ' + (count === 1 ? '1 viewing' : count + ' viewing');
        }
        updateShareStatus();
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
    updateShareStatus();
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
      // Track model from most recent historical message
      for (let i = msgs.length - 1; i >= 0; i--) {
        if (msgs[i].display && msgs[i].display.model) {
          _shareModel = msgs[i].display.model;
          break;
        }
      }
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
  updateShareModelDisplay();
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
  // Check if a share already exists for this project
  try {
    const r = await fetch('/api/shares');
    const shares = await r.json();
    const existing = shares.find(s => s.project === project);
    if (existing) {
      // Show existing share URL directly
      const origin = publicOrigin || window.location.origin;
      const url = origin + '/?t=' + existing.token;
      setCurrentShareUrl(url);
      // Attach locally cached password
      existing.password = getSharePasswords()[existing.token] || null;
      showShareResult(existing, false);
      return;
    }
  } catch {}

  // No existing share — show creation modal
  // Clean up any stray btn-row from previous result modal
  const modalInner = document.getElementById('modal').querySelector('.modal');
  for (const el of modalInner.querySelectorAll(':scope > .btn-row')) el.remove();
  // Show pre-creation modal — default to public access
  const randomPwd = generateRandomPassword();
  document.getElementById('modalTitle').textContent = 'Share: ' + project;
  document.getElementById('modalBody').innerHTML =
    '<div class="share-toggle-row">' +
      '<label class="share-toggle-label">' +
        '<input type="checkbox" id="sharePasswordToggle">' +
        '<span>Require password</span>' +
      '</label>' +
    '</div>' +
    '<div class="share-password-section" id="sharePasswordSection" style="display:none">' +
      '<div class="hint">Set a password. Viewers will need to enter it before accessing the content.</div>' +
      '<div class="share-password-row">' +
        '<input type="text" id="sharePasswordInput" value="' + esc(randomPwd) + '" maxlength="20" spellcheck="false">' +
        '<button type="button" class="share-password-toggle" id="sharePwdToggle" title="Show/Hide">👁</button>' +
      '</div>' +
    '</div>' +
    '<div class="hint" id="sharePublicHint">Anyone with the link can view this project.</div>' +
    '<div class="btn-row" style="margin-top:16px">' +
      '<button type="button" id="modalCloseBtn">Cancel</button>' +
      '<button type="button" id="shareCreateBtn" class="primary">Create Share</button>' +
    '</div>';
  document.getElementById('modal').style.display = 'flex';

  const pwdToggle = document.getElementById('sharePasswordToggle');
  const pwdSection = document.getElementById('sharePasswordSection');
  const publicHint = document.getElementById('sharePublicHint');
  const pwdInput = document.getElementById('sharePasswordInput');

  // Toggle password section visibility
  pwdToggle.addEventListener('change', () => {
    const show = pwdToggle.checked;
    pwdSection.style.display = show ? 'block' : 'none';
    publicHint.style.display = show ? 'none' : 'block';
  });

  // Toggle password field visibility
  document.getElementById('sharePwdToggle').addEventListener('click', () => {
    pwdInput.type = pwdInput.type === 'text' ? 'password' : 'text';
  });

  // Cancel
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);

  // Create
  document.getElementById('shareCreateBtn').addEventListener('click', async () => {
    const usePassword = pwdToggle.checked;
    const password = pwdInput.value.trim();
    if (usePassword && !password) { pwdInput.style.borderColor = '#e74c3c'; return; }
    try {
      const body = { project };
      if (usePassword) body.password = password;
      const r = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await r.json();
      if (!r.ok) { alert('Error: ' + data.error); return; }
      const origin = publicOrigin || window.location.origin;
      setCurrentShareUrl(origin + data.url);
      // Cache password locally
      if (data.password) saveSharePassword(data.token, data.password);
      showShareResult(data, true);
    } catch (e) { alert('Failed to create share: ' + e.message); }
  });
}

function showShareResult(data, isNew) {
  const title = isNew ? 'Share Created' : 'Share: ' + data.project;
  const hasPwd = !!data.password;
  let pwdDisplay = '';
  if (hasPwd) {
    pwdDisplay = '<div class="share-pwd-display">' +
        '<div class="label">Password</div>' +
        '<div class="value">' + esc(data.password) + '</div>' +
      '</div>';
  }
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML =
    '<div class="hint">' + (hasPwd ? 'Share this URL and password to let others view this project:' : 'Share this URL to let others view this project:') + '</div>' +
    '<div class="share-url" id="shareUrlText">' + esc(currentShareUrl) + '</div>' +
    pwdDisplay +
    '<div class="hint">The project name is not visible in the URL. Revoke at any time from the sidebar.</div>' +
    '<div class="btn-row" style="margin-top:16px">' +
      '<button type="button" id="modalCloseBtn">Close</button>' +
      '<button type="button" id="modalCopyBtn" class="primary">Copy URL</button>' +
    '</div>';
  document.getElementById('modal').style.display = 'flex';
  document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
  document.getElementById('modalCopyBtn').addEventListener('click', copyShareUrl);
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
