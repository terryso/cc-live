export const sessions = new Map();
export const _devTimers = new Map();
export const DEV_TIMEOUT = 120000;

export let activeProject = null;
export let loadedBefore = null;
export let hasMoreHistory = true;
export let isLoadingHistory = false;
export let isShareView = !!new URLSearchParams(window.location.search).get('t');
export let shareProject = null;
export let currentShareUrl = '';
export let publicOrigin = null;
export let activeFilter = 'all';
export let filterBar = null;
export let filterCount = null;

export function setActiveProject(v) { activeProject = v; }
export function setLoadedBefore(v) { loadedBefore = v; }
export function setHasMoreHistory(v) { hasMoreHistory = v; }
export function setIsLoadingHistory(v) { isLoadingHistory = v; }
export function setIsShareView(v) { isShareView = v; }
export function setShareProject(v) { shareProject = v; }
export function setCurrentShareUrl(v) { currentShareUrl = v; }
export function setPublicOrigin(v) { publicOrigin = v; }
export function setActiveFilter(v) { activeFilter = v; }
export function setFilterBar(el) { filterBar = el; }
export function setFilterCount(el) { filterCount = el; }

// Callback to break circular dependency between render.js ↔ api.js
export let loadMessages = () => {};
export function setLoadMessages(fn) { loadMessages = fn; }
