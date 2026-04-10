import { setFilterBar, setFilterCount, setActiveFilter, activeFilter, setLoadMessages, hasMoreHistory, isLoadingHistory, isShareView, sessions, activeProject, isDanmakuOn } from './state.js';
import { toggleThinking, applyFilter, revokeShare } from './render.js';
import { connect, closeModal, copyShareUrl, createShare, loadMessages } from './api.js';
import { getNickname, setNickname, sendDanmaku, toggleDanmaku, EMOJIS } from './danmaku.js';

// Expose functions called from dynamically generated HTML
window._toggleThinking = toggleThinking;
window._createShare = createShare;
window._revokeShare = revokeShare;
window._closeModal = closeModal;
window._copyShareUrl = copyShareUrl;

// Init DOM refs for state
const filterBarEl = document.getElementById('filterBar');
const filterCountEl = document.getElementById('filterCount');
setFilterBar(filterBarEl);
setFilterCount(filterCountEl);

// --- Theme toggle ---
const themeToggle = document.getElementById('themeToggle');
const savedTheme = localStorage.getItem('cc-live-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

function setHljsTheme(theme) {
  document.getElementById('hljs-light').disabled = (theme === 'dark');
  document.getElementById('hljs-dark').disabled = (theme !== 'dark');
}
setHljsTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('cc-live-theme', next);
  themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
  setHljsTheme(next);
});

// --- Mobile menu ---
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');

mobileMenuBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  sidebarOverlay.classList.toggle('active');
});
sidebarOverlay.addEventListener('click', () => {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
});


// --- Role filter ---
filterBarEl.addEventListener('click', e => {
  const chip = e.target.closest('.filter-chip');
  if (!chip) return;
  const role = chip.dataset.role;
  if (role === activeFilter) return;
  setActiveFilter(role);
  filterBarEl.querySelectorAll('.filter-chip').forEach(c => c.classList.toggle('active', c.dataset.role === role));
  applyFilter();
});

// --- Scroll navigation ---
const msgsEl = document.getElementById('msgs');
const scrollBtnTop = document.getElementById('scrollToTop');
const scrollBtnBottom = document.getElementById('scrollToBottom');
let _lastHistoryLoad = 0;

scrollBtnTop.addEventListener('click', () => { msgsEl.scrollTop = 0; });
scrollBtnBottom.addEventListener('click', () => { msgsEl.scrollTop = msgsEl.scrollHeight; });

msgsEl.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = msgsEl;
  const atBottom = scrollHeight - scrollTop - clientHeight < 80;
  const atTop = scrollTop < 80;
  scrollBtnTop.classList.toggle('visible', atBottom && scrollTop > 80);
  scrollBtnBottom.classList.toggle('visible', atTop && scrollHeight - clientHeight > 80);
  // Auto-load history when scrolled to top (cooldown prevents momentum scroll re-trigger on mobile)
  if (scrollTop < 60 && hasMoreHistory && !isLoadingHistory && Date.now() - _lastHistoryLoad > 1000) {
    _lastHistoryLoad = Date.now();
    loadMessages();
  }
});

// --- Modal buttons ---
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
document.getElementById('modalCopyBtn').addEventListener('click', copyShareUrl);

// --- Danmaku UI ---
const danmakuBar = document.getElementById('danmaku-bar');
const danmakuNick = document.getElementById('danmakuNick');
const danmakuInput = document.getElementById('danmakuInput');
const danmakuSend = document.getElementById('danmakuSend');
const danmakuToggle = document.getElementById('danmakuToggle');
const danmakuEmojiBtn = document.getElementById('danmakuEmojiBtn');
const danmakuEmojiPicker = document.getElementById('danmakuEmojiPicker');

// Show danmaku bar only on share pages
function initDanmakuUI() {
  if (!isShareView) return;
  danmakuBar.style.display = 'flex';
  danmakuNick.textContent = getNickname();
  // Restore danmaku on/off state
  const saved = localStorage.getItem('danmaku-on');
  if (saved === 'false') {
    toggleDanmaku(false);
    danmakuToggle.classList.add('off');
  }

  // Populate emoji picker
  for (const emoji of EMOJIS) {
    const btn = document.createElement('button');
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      const pos = danmakuInput.selectionStart;
      const val = danmakuInput.value;
      danmakuInput.value = val.slice(0, pos) + emoji + val.slice(pos);
      danmakuInput.focus();
      danmakuInput.setSelectionRange(pos + emoji.length, pos + emoji.length);
      danmakuEmojiPicker.style.display = 'none';
    });
    danmakuEmojiPicker.appendChild(btn);
  }
}

// Re-check after SSE share-info arrives
const origTitle = document.getElementById('title');
const titleObserver = new MutationObserver(() => {
  if (danmakuBar.style.display === 'none') initDanmakuUI();
});
titleObserver.observe(origTitle, { childList: true });
initDanmakuUI();

// Nickname edit modal
const nickModal = document.getElementById('nickModal');
const nickInput = document.getElementById('nickInput');
const nickCancelBtn = document.getElementById('nickCancelBtn');
const nickSaveBtn = document.getElementById('nickSaveBtn');

function openNickModal() {
  nickInput.value = getNickname();
  nickModal.style.display = 'flex';
  nickInput.focus();
  nickInput.select();
}

function closeNickModal() {
  nickModal.style.display = 'none';
}

function saveNickEdit() {
  const val = nickInput.value.trim();
  if (val) {
    danmakuNick.textContent = setNickname(val);
  }
  closeNickModal();
}

danmakuNick.addEventListener('click', openNickModal);
nickCancelBtn.addEventListener('click', closeNickModal);
nickSaveBtn.addEventListener('click', saveNickEdit);
nickInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveNickEdit();
  if (e.key === 'Escape') closeNickModal();
});
nickModal.addEventListener('click', e => {
  if (e.target === nickModal) closeNickModal();
});

// Emoji picker toggle
danmakuEmojiBtn.addEventListener('click', () => {
  danmakuEmojiPicker.style.display = danmakuEmojiPicker.style.display === 'none' ? 'flex' : 'none';
});

// Close emoji picker on outside click
document.addEventListener('click', e => {
  if (!danmakuEmojiBtn.contains(e.target) && !danmakuEmojiPicker.contains(e.target)) {
    danmakuEmojiPicker.style.display = 'none';
  }
});

// Send danmaku
function doSendDanmaku() {
  const content = danmakuInput.value.trim();
  if (!content) return;
  // Find an active session to attach to
  let sessionId = null;
  for (const [sid, s] of sessions) {
    if (s.projectName === activeProject || !activeProject) { sessionId = sid; break; }
  }
  if (!sessionId) return;
  sendDanmaku(sessionId, getNickname(), content).catch(() => {});
  danmakuInput.value = '';
}

danmakuSend.addEventListener('click', doSendDanmaku);
danmakuInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doSendDanmaku();
});

// Danmaku toggle
danmakuToggle.addEventListener('click', () => {
  const on = !isDanmakuOn;
  toggleDanmaku(on);
  danmakuToggle.classList.toggle('off', !on);
  localStorage.setItem('danmaku-on', on);
});

// --- Connect ---
setLoadMessages(loadMessages);
connect();
