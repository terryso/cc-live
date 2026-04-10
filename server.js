import { createServer } from "http";
import { readFile, writeFile, mkdir, stat, readdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomBytes, randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { BASE_SENSITIVE_PATTERNS, loadCustomPatterns, parseLine, extractDisplayMessage, validateShareTokenEntries, listSessions as _listSessions, getProjectMessages as _getProjectMessages, listProjects as _listProjects, computeProjectStats as _computeProjectStats } from "./lib.js";

// ── Load .env ───────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envContent = await readFile(join(__dirname, ".env"), "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
  console.log("  Loaded .env");
} catch {}

// ── Config ──────────────────────────────────────────────
const PORT = process.env.CC_LIVE_PORT || 3456;
const CLAUDE_DIR = process.env.CLAUDE_DIR || join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const MAX_PROJECTS = 50;
const MAX_AGE_DAYS = 7;
const ONE_WEEK_MS = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// ── State ───────────────────────────────────────────────
const clients = new Map(); // clientId -> { res, token? }
const watchedFiles = new Map(); // filepath -> { offset, sessionId, projectName, interval }
const sessions = new Map(); // sessionId -> { projectName, messages[], active }
const shareTokens = new Map(); // token -> { project, createdAt }

// ── SSE helpers ─────────────────────────────────────────
function sseSend(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// Heartbeat to keep SSE connections alive through proxies
setInterval(() => {
  for (const [, c] of clients) {
    if (!c.res.writableEnded) c.res.write(": heartbeat\n\n");
  }
}, 15000);

function broadcast(event, data, projectName) {
  for (const [, c] of clients) {
    // If client is on a share token, only send if project matches
    if (c.token) {
      const share = shareTokens.get(c.token);
      if (!share || share.project !== projectName) continue;
    }
    sseSend(c.res, event, data);
  }
}

function broadcastViewerCount() {
  for (const [, c] of clients) {
    if (!c.res.writableEnded) sseSend(c.res, "viewer_count", { count: clients.size });
  }
}

// ── Share token persistence ──────────────────────────────
const SHARE_TOKENS_FILE = join(__dirname, "data", "share-tokens.json");

async function loadShareTokens() {
  try {
    const content = await readFile(SHARE_TOKENS_FILE, "utf8");
    const entries = JSON.parse(content);
    const valid = validateShareTokenEntries(entries);
    for (const [token, info] of valid) {
      shareTokens.set(token, info);
    }
    if (shareTokens.size > 0) console.log(`  Restored ${shareTokens.size} share token(s)`);
  } catch (e) {
    if (e.code === "ENOENT") { /* first run */ }
    else if (e instanceof SyntaxError) console.warn("  share-tokens.json corrupt, starting empty");
    else console.warn("  Could not load share-tokens.json:", e.message);
  }
}

let _saveInProgress = false;
let _saveQueued = false;

async function saveShareTokens() {
  if (_saveInProgress) { _saveQueued = true; return; }
  _saveInProgress = true;
  do {
    _saveQueued = false;
    try {
      await mkdir(join(__dirname, "data"), { recursive: true });
      const obj = Object.fromEntries(shareTokens);
      await writeFile(SHARE_TOKENS_FILE, JSON.stringify(obj, null, 2), "utf8");
    } catch (e) {
      console.error("  Failed to save share tokens:", e.message);
    }
  } while (_saveQueued);
  _saveInProgress = false;
}

// ── Share token helpers ─────────────────────────────────
function generateToken() {
  return randomBytes(12).toString("hex"); // 24-char hex
}

function resolveToken(token) {
  if (!token) return null;
  return shareTokens.get(token) || null;
}

// ── Danmaku helpers ─────────────────────────────────────
const DANMAKU_DIR = join(__dirname, "data", "danmaku");
const DANMAKU_MAX_ENTRIES = 5000;
const danmakuLocks = new Map();

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function loadDanmaku(project) {
  try {
    const safe = project.replace(/[/\\]/g, "_");
    const content = await readFile(join(DANMAKU_DIR, `${safe}.json`), "utf8");
    return JSON.parse(content);
  } catch { return []; }
}

async function saveDanmaku(project, data) {
  await mkdir(DANMAKU_DIR, { recursive: true });
  const safe = project.replace(/[/\\]/g, "_");
  await writeFile(join(DANMAKU_DIR, `${safe}.json`), JSON.stringify(data), "utf8");
}

// Per-project mutex to prevent read-modify-write races
async function appendDanmaku(project, entry) {
  if (!danmakuLocks.has(project)) danmakuLocks.set(project, []);
  const q = danmakuLocks.get(project);
  if (q.length > 0) {
    await new Promise(r => q.push(r));
  }
  try {
    const existing = await loadDanmaku(project);
    existing.push(entry);
    // Cap at DANMAKU_MAX_ENTRIES, drop oldest
    if (existing.length > DANMAKU_MAX_ENTRIES) {
      existing.splice(0, existing.length - DANMAKU_MAX_ENTRIES);
    }
    await saveDanmaku(project, existing);
  } finally {
    const next = q.shift();
    if (q.length === 0) danmakuLocks.delete(project);
    if (next) next();
  }
}

// ── JSONL parsing & redaction (imported from lib.js) ────

// ── Sensitive data redaction ──────────────────────────────
const SENSITIVE_PATTERNS = [...BASE_SENSITIVE_PATTERNS, ...loadCustomPatterns(process.env)];
if (process.env.CC_LIVE_REDACT_1) {
  console.log(`  Loaded ${SENSITIVE_PATTERNS.length - BASE_SENSITIVE_PATTERNS.length} custom redaction rule(s)`);
}

// ── Session file discovery ──────────────────────────────
async function findAllSessionFiles() {
  const now = Date.now();
  const cutoff = now - ONE_WEEK_MS;
  const projectFiles = new Map(); // projectName -> [files]
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir);
      let st;
      try { st = await stat(dirPath); if (!st.isDirectory()) continue; } catch { continue; }

      const projectName = dir.replace(/^-/, "").replace(/-/g, "/").replace(/^\//, "");
      const entries = await readdir(dirPath);
      const recentFiles = [];
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) {
          const fullPath = join(dirPath, entry);
          try {
            const fst = await stat(fullPath);
            if (fst.mtimeMs >= cutoff) {
              recentFiles.push({ path: fullPath, sessionId: entry.replace(".jsonl", ""), projectName, mtime: fst.mtimeMs, size: fst.size, isSubagent: false });
            }
          } catch {}
        }
      }
      if (recentFiles.length > 0) {
        projectFiles.set(projectName, recentFiles);
      }
    }
  } catch (e) { console.error("Scan error:", e.message); }

  // Sort projects by most recent file mtime, take top MAX_PROJECTS
  const sortedProjects = [...projectFiles.entries()]
    .map(([name, files]) => ({ name, files, latestMtime: Math.max(...files.map(f => f.mtime)) }))
    .sort((a, b) => b.latestMtime - a.latestMtime)
    .slice(0, MAX_PROJECTS);

  const allFiles = sortedProjects.flatMap(p => p.files);
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles;
}

// ── Watch a single file for new content ─────────────────
async function watchFile(filePath, sessionId, projectName, fromByteOffset) {
  if (watchedFiles.has(filePath)) return;

  // Read current content to get correct char offset (byte offset != char offset for UTF-8)
  let charOffset = 0;
  try {
    const current = await readFile(filePath, "utf8");
    charOffset = current.length;
  } catch {}

  const meta = { byteOffset: fromByteOffset, charOffset, sessionId, projectName, isSubagent: false };
  watchedFiles.set(filePath, meta);

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { projectName, isSubagent: false, messages: [], active: true });
    broadcast("session-new", { sessionId, projectName, isSubagent: false }, projectName);
  }

  meta.interval = setInterval(async () => {
    try {
      const st = await stat(filePath);
      if (st.size <= meta.byteOffset) return;

      const content = await readFile(filePath, "utf8");
      const newContent = content.slice(meta.charOffset);
      meta.charOffset = content.length;
      meta.byteOffset = st.size;

      for (const line of newContent.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const raw = parseLine(trimmed);
        if (!raw) continue;
        const msg = extractDisplayMessage(raw);
        if (!msg) continue;

        const session = sessions.get(sessionId);
        if (session) {
          session.messages.push(msg);
          if (session.messages.length > 500) session.messages = session.messages.slice(-300);
        }
        broadcast("message", { sessionId, ...msg }, projectName);
      }
    } catch {}
  }, 500);

  console.log(`  Watching: ${projectName || sessionId.slice(0, 8)}`);
}

// ── Load history from a JSONL file ──────────────────────
async function loadHistory(filePath, sessionId, limit) {
  try {
    const content = await readFile(filePath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    const tail = lines.slice(-limit);

    const messages = [];
    for (const line of tail) {
      const raw = parseLine(line.trim());
      if (!raw) continue;
      const msg = extractDisplayMessage(raw);
      if (msg) messages.push(msg);
    }
    return messages;
  } catch { return []; }
}

// ── Discover & watch all session files ──────────────────
let lastScanCount = 0;
async function discoverAndWatch() {
  const files = await findAllSessionFiles();

  for (const f of files) {
    if (!watchedFiles.has(f.path)) {
      // Load history first, then watch from end of file
      const history = await loadHistory(f.path, f.sessionId, 200);
      if (history.length > 0) {
        if (!sessions.has(f.sessionId)) {
          sessions.set(f.sessionId, { projectName: f.projectName, isSubagent: false, messages: [], active: true });
          broadcast("session-new", { sessionId: f.sessionId, projectName: f.projectName, isSubagent: false }, f.projectName);
        }
        const session = sessions.get(f.sessionId);
        session.messages = history;
        broadcast("history-loaded", { sessionId: f.sessionId, projectName: f.projectName, messageCount: history.length }, f.projectName);
      }
      watchFile(f.path, f.sessionId, f.projectName, f.size);
    }
  }

  if (files.length !== lastScanCount) {
    lastScanCount = files.length;
    console.log(`Tracking ${files.length} sessions across all projects`);
  }
}

// ── API helpers ─────────────────────────────────────────
function listSessions(projectFilter) {
  return _listSessions(sessions, projectFilter);
}

function getProjectMessages(projectName, before, limit) {
  return _getProjectMessages(sessions, projectName, before, limit);
}

function listProjects() {
  return _listProjects(sessions);
}

function computeProjectStats(projectName) {
  return _computeProjectStats(sessions, projectName);
}

// ── Read JSON body helper ───────────────────────────────
function readBody(req, maxBytes = 10240) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let oversized = false;
    req.on("data", (c) => {
      if (oversized) return;
      size += c.length;
      if (size > maxBytes) { oversized = true; req.destroy(); resolve(null); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

// ── HTTP + SSE server ───────────────────────────────────
function isLocalRequest(req) {
  const host = (req.headers.host || "").toLowerCase();
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}` || host === `[::1]:${PORT}`;
}

let detectedPublicOrigin = process.env.CC_LIVE_PUBLIC_URL || null; // e.g. https://xxx.ngrok-free.dev

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const tokenParam = url.searchParams.get("t");
  const share = resolveToken(tokenParam);
  const local = isLocalRequest(req);

  // CORS for all
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── Share management API (local only) ─────────────────
  // List shares
  if (req.method === "GET" && url.pathname === "/api/shares") {
    if (!local) { res.writeHead(403); res.end(); return; }
    const list = [];
    for (const [token, info] of shareTokens) {
      list.push({ token, project: info.project, createdAt: info.createdAt });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(list));
    return;
  }

  // Create share
  if (req.method === "POST" && url.pathname === "/api/shares") {
    if (!local) { res.writeHead(403); res.end(); return; }
    const body = await readBody(req);
    if (body === null) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request body too large" }));
      return;
    }
    if (!body.project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "project required" }));
      return;
    }
    // Verify project exists
    const projects = listProjects();
    if (!projects.find((p) => p.name === body.project)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "project not found" }));
      return;
    }
    const token = generateToken();
    shareTokens.set(token, { project: body.project, createdAt: Date.now() });
    saveShareTokens();
    const shareUrl = `/?t=${token}`;
    console.log(`  Share created: ${body.project} -> ${token}`);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ token, url: shareUrl, project: body.project }));
    return;
  }

  // Delete share
  const deleteShareMatch = url.pathname.match(/^\/api\/shares\/([a-f0-9]+)$/);
  if (req.method === "DELETE" && deleteShareMatch) {
    if (!local) { res.writeHead(403); res.end(); return; }
    const t = deleteShareMatch[1];
    if (shareTokens.has(t)) {
      shareTokens.delete(t);
      saveShareTokens();
      console.log(`  Share revoked: ${t}`);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token not found" }));
    }
    return;
  }

  // ── Project stats ──────────────────────────────────────
  if (url.pathname === "/api/project-stats") {
    const project = url.searchParams.get("project");
    if (!project) { res.writeHead(400); res.end(); return; }
    if (!local && (!share || share.project !== project)) { res.writeHead(200, "application/json"); res.end("{}"); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(computeProjectStats(project)));
    return;
  }

  // ── List projects ─────────────────────────────────────
  if (url.pathname === "/api/projects") {
    if (!local && !share) { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listProjects()));
    return;
  }

  // ── Project messages (paginated) ──────────────────────
  if (url.pathname === "/api/project-messages") {
    const project = url.searchParams.get("project");
    if (!project) { res.writeHead(400); res.end(); return; }
    if (!local && (!share || share.project !== project)) { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }
    const before = url.searchParams.has("before") ? url.searchParams.get("before") : null;
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getProjectMessages(project, before, limit)));
    return;
  }

  // ── Danmaku API ───────────────────────────────────────
  if (req.method === "GET" && url.pathname === "/api/danmaku") {
    if (!local && !share) { res.writeHead(403); res.end(); return; }
    const project = url.searchParams.get("project");
    if (!project) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "project required" })); return; }
    // Scope check: share users can only access their own project
    if (share && share.project !== project) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "access denied" })); return; }
    const danmaku = await loadDanmaku(project);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(danmaku));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/danmaku") {
    if (!local && !share) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "forbidden" })); return; }
    const body = await readBody(req);
    if (body === null) {
      res.writeHead(413, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "request body too large" }));
      return;
    }
    if (!body.content || !body.content.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "content required" }));
      return;
    }
    // Determine project: share users use their token's project, local must provide it
    const project = share ? share.project : body.project;
    if (!project) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "project required" }));
      return;
    }
    // Scope check: share users can only send to their own project
    if (share && share.project !== project) { res.writeHead(403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "access denied" })); return; }
    const content = escapeHtml(body.content.trim().slice(0, 200));
    const nickname = escapeHtml((body.nickname || "匿名").slice(0, 20));
    const entry = {
      id: randomUUID(),
      nickname,
      content,
      timestamp: new Date().toISOString(),
    };
    await appendDanmaku(project, entry);
    broadcast("danmaku", entry, project);
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify(entry));
    return;
  }

  // ── SSE endpoint ──────────────────────────────────────
  if (url.pathname === "/events") {
    // External without token: deny
    if (!local && !share) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      sseSend(res, "sessions", []);
      sseSend(res, "share-info", { project: null, error: "access denied" });
      req.on("close", () => {});
      return;
    }
    // Token-based access: must be valid
    if (tokenParam && !share) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid token" }));
      return;
    }

    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const clientInfo = { res, token: share ? tokenParam : null };
    clients.set(clientId, clientInfo);
    console.log(`Client connected: ${clientId} (${clients.size} total)${share ? ` [share: ${share.project}]` : local ? " [local]" : " [external]"}`);

    // Send filtered sessions
    const projectFilter = share ? share.project : null;
    sseSend(res, "sessions", listSessions(projectFilter));
    if (share) sseSend(res, "share-info", { project: share.project });
    // Send public origin for share URL generation
    if (detectedPublicOrigin) sseSend(res, "public-origin", detectedPublicOrigin);
    req.on("close", () => { clients.delete(clientId); broadcastViewerCount(); });
    broadcastViewerCount();
    return;
  }

  // ── API: list sessions ────────────────────────────────
  if (url.pathname === "/api/sessions") {
    if (!local && !share) { res.writeHead(200, { "Content-Type": "application/json" }); res.end("[]"); return; }
    const projectFilter = share ? share.project : null;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listSessions(projectFilter)));
    return;
  }

  // ── API: session history ──────────────────────────────
  const sessionMatch = url.pathname.match(/^\/api\/session\/(.+)$/);
  if (sessionMatch) {
    const sid = sessionMatch[1];
    const session = sessions.get(sid);
    if (session && session.messages.length > 0) {
      // If share token, verify project match
      if (share && session.projectName !== share.project) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "access denied" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: sid, projectName: session.projectName, messages: session.messages }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
    return;
  }

  // ── Serve static files (.js, .css) ──────────────────────
  if (url.pathname.startsWith("/js/") || url.pathname.startsWith("/style")) {
    const publicDir = join(__dirname, "public");
    const filePath = join(publicDir, url.pathname);
    if (!filePath.startsWith(publicDir)) { res.writeHead(403); res.end(); return; }
    const ext = filePath.endsWith(".js") ? "application/javascript"
              : filePath.endsWith(".css") ? "text/css"
              : "application/octet-stream";
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": `${ext}; charset=utf-8` });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  // ── Serve frontend ────────────────────────────────────
  const FRONTEND_PATH = join(__dirname, "public", "index.html");
  try {
    const html = await readFile(FRONTEND_PATH, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Failed to load frontend");
  }
});

// ── Startup ─────────────────────────────────────────────
await loadShareTokens();
server.listen(PORT, () => {
  console.log(`\n  CC Live running at http://localhost:${PORT}\n`);
  console.log("  Share publicly:");
  console.log(`  cloudflared tunnel --url http://localhost:${PORT}\n`);
  discoverAndWatch();
});

// Re-scan every 10s for new sessions
setInterval(discoverAndWatch, 10000);
