import { setFilterBar, setFilterCount, setActiveFilter, activeFilter, setLoadMessages, hasMoreHistory, isLoadingHistory } from './state.js';
import { toggleThinking, applyFilter, revokeShare } from './render.js';
import { connect, closeModal, copyShareUrl, createShare, loadMessages } from './api.js';

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

scrollBtnTop.addEventListener('click', () => { msgsEl.scrollTop = 0; });
scrollBtnBottom.addEventListener('click', () => { msgsEl.scrollTop = msgsEl.scrollHeight; });

msgsEl.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = msgsEl;
  const atBottom = scrollHeight - scrollTop - clientHeight < 80;
  const atTop = scrollTop < 80;
  scrollBtnTop.classList.toggle('visible', atBottom && scrollTop > 80);
  scrollBtnBottom.classList.toggle('visible', atTop && scrollHeight - clientHeight > 80);
  // Auto-load history when scrolled to top
  if (scrollTop < 60 && hasMoreHistory && !isLoadingHistory) {
    loadMessages();
  }
});

// --- Modal buttons ---
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
document.getElementById('modalCopyBtn').addEventListener('click', copyShareUrl);

// --- Connect ---
setLoadMessages(loadMessages);
connect();
