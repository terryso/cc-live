import { setFilterBar, setFilterCount, setActiveFilter, activeFilter, setLoadMessages, hasMoreHistory, isLoadingHistory, isShareView, activeProject, isDanmakuOn } from './state.js';
import { toggleThinking, applyFilter, revokeShare } from './render.js';
import { connect, closeModal, copyShareUrl, createShare, loadMessages } from './api.js';
import { getNickname, setNickname, sendDanmaku, toggleDanmaku, EMOJIS } from './danmaku.js';
import { initDashboard, updateDashboard } from './dashboard.js';

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

// --- Modal close on overlay click ---
document.getElementById('modal').addEventListener('click', e => {
  if (e.target === document.getElementById('modal')) closeModal();
});

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
let emojiCloseHandler = null;
danmakuEmojiBtn.addEventListener('click', e => {
  e.stopPropagation();
  const isOpen = danmakuEmojiPicker.style.display === 'flex';
  danmakuEmojiPicker.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen && !emojiCloseHandler) {
    emojiCloseHandler = ev => {
      if (!danmakuEmojiBtn.contains(ev.target) && !danmakuEmojiPicker.contains(ev.target)) {
        danmakuEmojiPicker.style.display = 'none';
        document.removeEventListener('click', emojiCloseHandler);
        emojiCloseHandler = null;
      }
    };
    setTimeout(() => document.addEventListener('click', emojiCloseHandler), 0);
  }
});

// Send danmaku
function doSendDanmaku() {
  const content = danmakuInput.value.trim();
  if (!content) return;
  const project = activeProject;
  if (!project) return;
  danmakuInput.value = '';
  sendDanmaku(project, getNickname(), content).catch(() => {
    danmakuInput.value = content;
    danmakuInput.style.borderColor = '#e74c3c';
    setTimeout(() => { danmakuInput.style.borderColor = ''; }, 1500);
  });
}

danmakuSend.addEventListener('click', doSendDanmaku);
danmakuInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) doSendDanmaku();
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
initDashboard();

// Share view: hide sidebar, show status in header
if (isShareView) {
  document.querySelector('.app').classList.add('share-view');
}

connect();

// --- Zen Mode ---
const appEl = document.querySelector('.app');
const zenExit = document.getElementById('zenExit');
let zenHoverTimeout = null;

function toggleZen(force) {
  const isZen = appEl.classList.toggle('zen', force);
  if (isZen) {
    // Hide exit button, show on mouse move to top
    zenExit.classList.remove('zen-exit-visible');
  } else {
    zenExit.classList.remove('zen-exit-visible');
  }
}

function handleZenMouseMove(e) {
  if (!appEl.classList.contains('zen')) return;
  if (e.clientY < 60) {
    zenExit.classList.add('zen-exit-visible');
    clearTimeout(zenHoverTimeout);
    zenHoverTimeout = setTimeout(() => {
      zenExit.classList.remove('zen-exit-visible');
    }, 3000);
  }
}

document.addEventListener('keydown', e => {
  // Don't toggle when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    toggleZen();
  }
  if (e.key === 'Escape' && appEl.classList.contains('zen')) {
    e.preventDefault();
    toggleZen(false);
  }
});

document.addEventListener('mousemove', handleZenMouseMove);
zenExit.addEventListener('click', () => toggleZen(false));

// Zen mode button in header
const zenToggle = document.getElementById('zenToggle');
zenToggle.addEventListener('click', () => toggleZen());
