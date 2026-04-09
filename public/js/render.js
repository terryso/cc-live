import { esc, isDiffContent, renderDiff, detectContentType } from './utils.js';
import {
  sessions, activeProject, isShareView, _devTimers, DEV_TIMEOUT,
  activeFilter, filterBar, filterCount, loadMessages,
  setActiveProject, setLoadedBefore, setHasMoreHistory, setActiveFilter
} from './state.js';

// --- Markdown config ---
const _mdAllowedTags = ['p','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','em','strong','del','a','table','thead','tbody','tr','th','td','hr','br','img','span','sup','sub','details','summary'];
const _mdAllowedAttr = ['href','alt','title','class','id','target','rel'];

marked.use({ breaks: true, gfm: true, renderer: { code({ text, lang }) {
  if (isDiffContent(lang, text)) return renderDiff(text);
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  return '<pre><code class="hljs language-' + language + '">' + hljs.highlight(text, { language }).value + '</code></pre>';
} } });

export function renderMd(text, isMarkdown) {
  if (!text) return '';
  if (isMarkdown) return DOMPurify.sanitize(marked.parse(text), { ALLOWED_TAGS: _mdAllowedTags, ALLOWED_ATTR: _mdAllowedAttr });
  return esc(text);
}

// --- Thinking ---
export function renderThinking(text) {
  if (!text || !text.trim()) return '';
  var TRUNCATE = 500;
  var rendered = renderMd(text, true);
  if (text.length <= TRUNCATE) return '<div class="msg-thinking">' + rendered + '</div>';
  var shortText = text.substring(0, TRUNCATE);
  var shortRendered = renderMd(shortText, true);
  return '<div class="msg-thinking">' +
    '<div class="thinking-collapsed">' + shortRendered +
    '<p style="margin:4px 0 0">…<span class="thinking-toggle" onclick="window._toggleThinking(this)">展开</span></p></div>' +
    '<div class="thinking-full">' + rendered +
    ' <span class="thinking-toggle" onclick="window._toggleThinking(this)">收起</span></div>' +
    '</div>';
}

export function toggleThinking(el) {
  var container = el.closest('.msg-thinking');
  if (!container) return;
  container.classList.toggle('thinking-expanded');
  var body = container.closest('.msg-body');
  if (body && body.classList.contains('collapsed')) body.classList.remove('collapsed');
}

// --- Tool formatters ---
function fmtBash(a) {
  var cmd = a.command || a.description || '';
  if (!cmd) return fmtFallback('Bash', a);
  return '<div class="tool-call tool-bash"><span class="ticon">⌨</span> <span class="tname">Bash</span>' +
    '<div class="tool-cmd">$ ' + esc(cmd) + '</div></div>';
}

function fmtRead(a) {
  var path = a.file_path || '';
  if (!path) return fmtFallback('Read', a);
  var info = '📄 ' + esc(path);
  if (a.offset != null && a.limit != null) info += ' <span class="tool-range">(L' + esc(String(a.offset)) + '-L' + esc(String(a.offset + a.limit - 1)) + ')</span>';
  return '<div class="tool-call tool-file">' + info + '</div>';
}

function fmtWrite(a) {
  var path = a.file_path || '';
  if (!path) return fmtFallback('Write', a);
  var h = '<div class="tool-call tool-file tool-write"><span class="ticon">📝</span> ' + esc(path);
  var lines = (a.content || '').split('\n').slice(0, 10);
  if (lines.length) h += '<pre class="tool-preview">' + esc(lines.join('\n')) + '</pre>';
  h += '</div>';
  return h;
}

function fmtEdit(a) {
  var path = a.file_path || '';
  var h = '<div class="tool-call tool-file tool-edit"><span class="ticon">✏️</span> ' + esc(path);
  if (a.old_string) h += '<div class="tool-diff-del">- ' + esc(a.old_string) + '</div>';
  if (a.new_string) h += '<div class="tool-diff-add">+ ' + esc(a.new_string) + '</div>';
  if (!a.old_string && !a.new_string) return fmtFallback('Edit', a);
  h += '</div>';
  return h;
}

function fmtSearch(name, a) {
  var pattern = a.pattern || '';
  if (!pattern) return fmtFallback(name, a);
  var h = '<div class="tool-call tool-search"><span class="ticon">🔍</span> ' + esc(name) + ' <span class="tool-pattern">"' + esc(pattern) + '"</span>';
  if (a.path) h += ' in <span class="tool-path">' + esc(a.path) + '</span>';
  h += '</div>';
  return h;
}

function fmtAgent(a) {
  var desc = a.description || '';
  if (!desc && a.prompt) desc = a.prompt.substring(0, 50) + (a.prompt.length > 50 ? '…' : '');
  var sub = a.subagent_type || '';
  var h = '<div class="tool-call tool-agent"><span class="ticon">🤖</span>';
  if (sub) h += ' ' + esc(sub);
  if (desc) h += ' <span class="tool-agent-desc">(' + esc(desc) + ')</span>';
  h += '</div>';
  return h;
}

function fmtTodo(a) {
  var todos = a.todos;
  if (!Array.isArray(todos)) return fmtFallback('TodoWrite', a);
  var h = '<div class="tool-call tool-todo"><span class="ticon">📋</span> TodoWrite<ul class="todo-list">';
  todos.forEach(function(t) {
    if (!t) return;
    var icon = t.status === 'completed' ? '☑' : (t.status === 'in_progress' ? '☐ ●' : '☐');
    var cls = t.status === 'completed' ? 'todo-done' : (t.status === 'in_progress' ? 'todo-active' : '');
    h += '<li class="' + cls + '">' + icon + ' ' + esc(t.content || '') + '</li>';
  });
  h += '</ul></div>';
  return h;
}

function fmtWebSearch(a) {
  var q = a.query || '';
  if (!q) return fmtFallback('WebSearch', a);
  return '<div class="tool-call tool-search"><span class="ticon">🌐</span> <span class="tool-pattern">"' + esc(q) + '"</span></div>';
}

function fmtFallback(name, a) {
  return '<div class="tool-call"><span class="tname">' + esc(name) + '</span><div class="targs">' + esc(JSON.stringify(a, null, 2)) + '</div></div>';
}

export function renderToolUse(p) {
  var args;
  try { args = JSON.parse(p.args); } catch(e) { return '<div class="tool-call"><span class="tname">' + esc(p.toolName) + '</span><div class="targs">' + esc(p.args) + '</div></div>'; }
  if (!args || typeof args !== 'object') args = {};
  var name = p.toolName;
  if (name === 'Bash') return fmtBash(args);
  if (name === 'Read') return fmtRead(args);
  if (name === 'Write') return fmtWrite(args);
  if (name === 'Edit') return fmtEdit(args);
  if (name === 'Grep' || name === 'Glob') return fmtSearch(name, args);
  if (name === 'Agent') return fmtAgent(args);
  if (name === 'TodoWrite') return fmtTodo(args);
  if (name === 'WebSearch') return fmtWebSearch(args);
  return fmtFallback(name, args);
}

// --- Tool result ---
function renderCodeResult(text) {
  if (/^```\w+/.test(text.trim())) return '<div class="tool-result">' + renderMd(text, true) + '</div>';
  if (isDiffContent(undefined, text)) return '<div class="tool-result tool-result-code">' + renderDiff(text) + '</div>';
  var highlighted = hljs.highlightAuto(text);
  return '<div class="tool-result tool-result-code"><pre><code class="hljs language-' + (highlighted.language && /^[a-z0-9-]+$/.test(highlighted.language) ? highlighted.language : 'plaintext') + '">' + highlighted.value + '</code></pre></div>';
}

function renderJsonResult(text) {
  try {
    var obj = JSON.parse(text);
    var pretty = JSON.stringify(obj, null, 2);
    return '<div class="tool-result tool-result-json"><pre>' + esc(pretty) + '</pre></div>';
  } catch(e) {
    return '<div class="tool-result">' + esc(text) + '</div>';
  }
}

export function renderToolResult(p) {
  if (!p || !p.text) return '';
  var text = p.text;
  if (!text.trim()) return '';
  var type = detectContentType(text);
  if (type === 'code') return renderCodeResult(text);
  if (type === 'json') return renderJsonResult(text);
  return '<div class="tool-result">' + DOMPurify.sanitize(marked.parse(text), { ALLOWED_TAGS: _mdAllowedTags, ALLOWED_ATTR: ['href','alt','title','target','rel'] }) + '</div>';
}

export function renderCommand(p) {
  if (!p || !p.name) return '';
  var h = '<div class="msg-command">';
  h += '<div class="cmd-header"><span class="cmd-prefix">></span> <span class="cmd-name">' + esc(p.name) + '</span></div>';
  if (p.args) h += '<div class="cmd-args">' + renderMd(p.args, false) + '</div>';
  h += '</div>';
  return h;
}

// --- Message rendering ---
export function msgContent(m) {
  const isMd = m.role === 'assistant';
  const cls = isMd ? 'msg-text md-render' : 'msg-text';
  let h = '';
  if (m.display) {
    if (m.display.type === 'text') h = '<div class="' + cls + '">' + renderMd(m.display.text, isMd) + '</div>';
    else if (m.display.type === 'command') h = renderCommand(m.display);
    else if (m.display.type === 'summary') h = '<div class="msg-text" style="color:var(--yellow)">' + esc(m.display.text) + '</div>';
    else if (m.display.type === 'blocks') {
      (m.display.parts || []).forEach(p => {
        if (p.type === 'text') h += '<div class="' + cls + '">' + renderMd(p.text, isMd) + '</div>';
        else if (p.type === 'command') h += renderCommand(p);
        else if (p.type === 'thinking') h += renderThinking(p.text);
        else if (p.type === 'tool_use') h += renderToolUse(p);
        else if (p.type === 'tool_result') h += renderToolResult(p);
      });
      if (m.display.model) h += '<span class="model-tag">' + esc(m.display.model) + '</span>';
    }
  }
  return h;
}

export function createMsgEl(m) {
  const d = document.createElement('div');
  d.className = 'msg ' + (m.role || 'system');
  const h = msgContent(m);
  if (!h) { d.style.display = 'none'; return d; }
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
  d.innerHTML = '<div class="msg-role ' + (m.role || 'system') + '">' + (m.role || 'system') + '</div><div class="msg-body collapsible collapsed">' + h + '</div>' + (ts ? '<div class="ts">' + ts + '</div>' : '');
  return d;
}

export function appendMsg(m) {
  const el = document.getElementById('msgs');
  const e = el.querySelector('.empty'); if (e) e.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + (m.role || 'system');
  const h = msgContent(m);
  if (!h) return;
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
  d.innerHTML = '<div class="msg-role ' + (m.role || 'system') + '">' + (m.role || 'system') + '</div><div class="msg-body collapsible collapsed">' + h + '</div>' + (ts ? '<div class="ts">' + ts + '</div>' : '');
  if (activeFilter !== 'all' && !d.classList.contains(activeFilter)) d.style.display = 'none';
  el.appendChild(d);
  addExpandButtons(d);
  if (activeFilter !== 'all') {
    const total = el.querySelectorAll('.msg').length;
    const visible = el.querySelectorAll('.msg.' + activeFilter).length;
    filterCount.textContent = visible + '/' + total;
  }
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distFromBottom < el.clientHeight) el.scrollTop = el.scrollHeight;
}

// --- UI helpers ---
export function addExpandButtons(container) {
  container.querySelectorAll('.collapsible.collapsed').forEach(el => {
    if (el.scrollHeight <= el.clientHeight + 10) {
      el.classList.remove('collapsed');
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'expand-btn';
    btn.textContent = 'Show more';
    btn.onclick = function() {
      if (el.classList.contains('collapsed')) {
        el.classList.remove('collapsed');
        btn.textContent = 'Show less';
      } else {
        el.classList.add('collapsed');
        btn.textContent = 'Show more';
      }
    };
    el.parentNode.insertBefore(btn, el.nextSibling);
  });
}

export function applyFilter() {
  const msgsEl = document.getElementById('msgs');
  const msgEls = msgsEl.querySelectorAll('.msg');
  let visible = 0, total = 0;
  msgEls.forEach(el => {
    total++;
    const match = activeFilter === 'all' || el.classList.contains(activeFilter);
    el.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const dividers = msgsEl.querySelectorAll('.session-divider');
  dividers.forEach(d => d.style.display = activeFilter === 'all' ? '' : 'none');
  filterCount.textContent = activeFilter === 'all' ? '' : visible + '/' + total;
}

export function showFilterBar() {
  filterBar.classList.add('visible');
}

// --- Active dev indicator ---
export function markActive(project) {
  const prev = _devTimers.get(project);
  if (prev) clearTimeout(prev);
  _devTimers.set(project, setTimeout(() => {
    _devTimers.delete(project);
    renderList();
  }, DEV_TIMEOUT));
  renderList();
}

// --- Project list ---
export function getProjects() {
  const groups = new Map();
  for (const [, s] of sessions) {
    if (s.isSubagent) continue;
    const key = s.projectName || 'unknown';
    if (!groups.has(key)) groups.set(key, { sessionCount: 0, totalMessages: 0 });
    const g = groups.get(key);
    g.sessionCount++;
    g.totalMessages += s.messages.length;
  }
  return [...groups.entries()].sort((a, b) => b[1].totalMessages - a[1].totalMessages);
}

export function renderList() {
  const el = document.getElementById('slist');
  const projects = getProjects();
  el.innerHTML = '';
  for (const [proj, info] of projects) {
    const d = document.createElement('div');
    d.className = 'pitem' + (proj === activeProject ? ' active' : '');
    const devActive = _devTimers.has(proj);
    const dot = devActive ? '<span class="dev-dot"></span>' : '';
    const meta = (devActive ? dot + '<span style="color:var(--green)">直播中</span> · ' : '<span style="color:var(--dim)">空闲</span> · ') + info.sessionCount + ' sessions · ' + info.totalMessages + ' msgs';
    let inner = '<div class="pitem-info"><div class="pname">' + esc(proj) + '</div><div class="pmeta">' + meta + '</div></div>';
    if (!isShareView) {
      inner += '<button class="share-btn" onclick="event.stopPropagation();window._createShare(\''+esc(proj).replace(/'/g,"\\'")+'\')">Share</button>';
    }
    d.innerHTML = inner;
    d.onclick = () => { selectProject(proj); closeMobileMenu(); };
    el.appendChild(d);
  }
  if (!isShareView) loadShares();
}

export function selectProject(proj) {
  setActiveProject(proj);
  setLoadedBefore(null);
  setHasMoreHistory(true);
  setActiveFilter('all');
  filterBar.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.role === 'all'));
  filterCount.textContent = '';
  document.getElementById('title').textContent = proj;
  document.getElementById('path').textContent = '';
  showFilterBar();
  renderList();
  loadMessages();
}

export function closeMobileMenu() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('active');
}

// --- Shares ---
export async function loadShares() {
  try {
    const r = await fetch('/api/shares');
    const shares = await r.json();
    const panel = document.getElementById('sharesPanel');
    const list = document.getElementById('sharesList');
    if (shares.length === 0) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    list.innerHTML = '';
    for (const s of shares) {
      const d = document.createElement('div');
      d.className = 'share-item';
      d.innerHTML = '<span class="sh-proj">' + esc(s.project) + '</span><span class="sh-token">' + s.token.slice(0, 8) + '...</span><button class="revoke-btn" onclick="window._revokeShare(\'' + s.token + '\')">Revoke</button>';
      list.appendChild(d);
    }
  } catch {}
}

export async function revokeShare(token) {
  await fetch('/api/shares/' + token, { method: 'DELETE' });
  loadShares();
}
