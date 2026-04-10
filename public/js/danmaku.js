import { isDanmakuOn, setIsDanmakuOn } from './state.js';

// ── Nickname ──────────────────────────────────────────────
const ADJECTIVES = ['快乐','勇敢','温柔','活泼','机智','可爱','优雅','淡定','呆萌','元气','沉默','傲娇','佛系','热情','酷酷','神秘','灵动','憨厚','乖巧','潇洒'];
const NOUNS = ['水豚','猫咪','柴犬','企鹅','海獭','仓鼠','浣熊','兔子','松鼠','小鹿','海豚','鹦鹉','狐狸','熊猫','刺猬','考拉','海鸥','猫头鹰','白鲸','树懒'];

function generateNickname() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return adj + noun;
}

export function getNickname() {
  let name = localStorage.getItem('danmaku-nickname');
  if (!name) {
    name = generateNickname();
    localStorage.setItem('danmaku-nickname', name);
  }
  return name;
}

export function setNickname(name) {
  const trimmed = name.slice(0, 20);
  localStorage.setItem('danmaku-nickname', trimmed);
  return trimmed;
}

// ── Danmaku API ───────────────────────────────────────────
export async function sendDanmaku(sessionId, nickname, content) {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  const url = '/api/danmaku' + (t ? '?t=' + encodeURIComponent(t) : '');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, nickname, content }),
  });
  if (!res.ok) throw new Error('Failed to send danmaku');
  return res.json();
}

export async function loadDanmakuHistory(sessionId) {
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  const url = '/api/danmaku?sessionId=' + encodeURIComponent(sessionId) + (t ? '&t=' + encodeURIComponent(t) : '');
  const res = await fetch(url);
  if (!res.ok) return [];
  return res.json();
}

// ── Danmaku queue & rendering ─────────────────────────────
const MAX_ONSCREEN = 15;
let activeCount = 0;
const queue = []; // stores { item, isHistory }
const NICKNAME_COLORS = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#fd79a8'];

function pickColor(nickname) {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) hash = ((hash << 5) - hash) + nickname.charCodeAt(i);
  return NICKNAME_COLORS[Math.abs(hash) % NICKNAME_COLORS.length];
}

function renderDanmakuItem(item, isHistory) {
  if (!isDanmakuOn) {
    if (isHistory) return; // skip history silently when toggle is off
    queue.push({ item, isHistory });
    return;
  }
  if (activeCount >= MAX_ONSCREEN) {
    queue.push({ item, isHistory });
    return;
  }
  spawnDanmaku(item, isHistory);
}

function spawnDanmaku(item, isHistory) {
  const layer = document.getElementById('danmaku-layer');
  if (!layer || !isDanmakuOn) return;

  activeCount++;
  const el = document.createElement('div');
  el.className = 'danmaku-item';
  const nick = document.createElement('span');
  nick.className = 'danmaku-item-nick';
  nick.style.color = pickColor(item.nickname);
  nick.textContent = item.nickname;
  const text = document.createElement('span');
  text.className = 'danmaku-text';
  text.textContent = item.content;
  el.appendChild(nick);
  el.appendChild(document.createTextNode(': '));
  el.appendChild(text);

  // Random vertical position (top 5%-75%)
  const top = 5 + Math.random() * 70;
  el.style.top = top + '%';

  // Duration 6-10s for variety
  const duration = 6 + Math.random() * 4;
  el.style.animationDuration = duration + 's';

  if (isHistory) {
    // Stagger history: random delay 0-3s
    const delay = Math.random() * 3;
    el.style.animationDelay = delay + 's';
    el.style.opacity = '0';
  }

  layer.appendChild(el);

  // Guard against double cleanup (animationend + setTimeout)
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    el.remove();
    activeCount--;
    drainQueue();
  };

  el.addEventListener('animationend', cleanup);
  // Fallback timeout in case animationend doesn't fire
  const totalMs = isHistory ? (duration + 3) * 1000 : duration * 1000;
  setTimeout(cleanup, totalMs + 500);
}

function drainQueue() {
  while (queue.length > 0 && activeCount < MAX_ONSCREEN && isDanmakuOn) {
    const { item, isHistory } = queue.shift();
    spawnDanmaku(item, isHistory);
  }
}

// ── Public API ────────────────────────────────────────────
export function handleDanmakuEvent(data) {
  renderDanmakuItem(data, false);
}

export function playbackHistory(items) {
  for (const item of items) {
    renderDanmakuItem(item, true);
  }
}

export function toggleDanmaku(on) {
  setIsDanmakuOn(on);
  const layer = document.getElementById('danmaku-layer');
  if (!on && layer) {
    // Clear all active danmaku immediately
    layer.querySelectorAll('.danmaku-item').forEach(el => el.remove());
    activeCount = 0;
  }
  if (on) {
    drainQueue();
  }
}

// ── Emoji picker data ─────────────────────────────────────
export const EMOJIS = ['👍','❤️','😂','🎉','🔥','👏','😮','💯','✨','🙌','😎','🤔','👀','💪','🚀','⭐'];
