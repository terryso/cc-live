import { createServer } from "http";
import { readFile, stat, readdir } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { fileURLToPath } from "url";

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
const PORT = process.env.CC_WATCH_PORT || 3456;
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

// ── Share token helpers ─────────────────────────────────
function generateToken() {
  return randomBytes(12).toString("hex"); // 24-char hex
}

function resolveToken(token) {
  if (!token) return null;
  return shareTokens.get(token) || null;
}

// ── JSONL parsing ───────────────────────────────────────
const SKIP_TYPES = new Set(["queue-operation", "file-history-snapshot", "change", "last-prompt"]);

function parseLine(line) {
  try {
    const obj = JSON.parse(line);
    if (SKIP_TYPES.has(obj.type)) return null;
    return obj;
  } catch { return null; }
}

function truncate(str, max) {
  if (!str) return "";
  return str.length <= max ? str : str.slice(0, max) + "...";
}

function extractDisplayMessage(raw) {
  const { type, uuid, timestamp, message, isSidechain, cwd } = raw;

  if (type === "summary") {
    return { uuid, timestamp, role: "system", display: { type: "summary", text: message?.summary || "" }, isSidechain, cwd };
  }

  if (type === "user") {
    const content = message?.content;
    if (typeof content === "string") {
      if (content.startsWith("<local-command-caveat>")) return null;
      if (content.startsWith("<command-name>")) return null;
      if (content.startsWith("<local-command-")) return null;
      return { uuid, timestamp, role: "user", display: { type: "text", text: content }, isSidechain, cwd };
    }
    if (Array.isArray(content)) {
      const parts = [];
      for (const block of content) {
        if (block.type === "tool_result") {
          const text = typeof block.content === "string" ? block.content
            : Array.isArray(block.content) ? block.content.map(c => c.type === "text" ? c.text : c.type === "tool_reference" ? `[${c.tool_name}]` : "").join("\n")
            : JSON.stringify(block.content);
          parts.push({ type: "tool_result", toolUseId: block.tool_use_id, text: truncate(text, 500) });
        } else if (block.type === "text") {
          parts.push({ type: "text", text: block.text });
        }
      }
      if (!parts.length) return null;
      return { uuid, timestamp, role: "user", display: { type: "blocks", parts }, isSidechain, cwd };
    }
    return null;
  }

  if (type === "assistant") {
    const content = message?.content;
    if (!Array.isArray(content)) return null;
    const parts = [];
    for (const block of content) {
      if (block.type === "text") parts.push({ type: "text", text: block.text });
      else if (block.type === "thinking") parts.push({ type: "thinking", text: truncate(block.thinking, 500) });
      else if (block.type === "tool_use") {
        parts.push({ type: "tool_use", toolName: block.name, toolCallId: block.id, args: truncate(JSON.stringify(block.input), 300) });
      }
    }
    if (!parts.length) return null;
    return { uuid, timestamp, role: "assistant", display: { type: "blocks", parts, model: message?.model || "" }, isSidechain, cwd };
  }
  return null;
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
function watchFile(filePath, sessionId, projectName, fromOffset) {
  if (watchedFiles.has(filePath)) return;

  const meta = { offset: fromOffset, sessionId, projectName, isSubagent: false };
  watchedFiles.set(filePath, meta);

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { projectName, isSubagent: false, messages: [], active: true });
    broadcast("session-new", { sessionId, projectName, isSubagent: false }, projectName);
  }

  meta.interval = setInterval(async () => {
    try {
      const st = await stat(filePath);
      if (st.size <= meta.offset) return;

      const content = await readFile(filePath, "utf8");
      const newContent = content.slice(meta.offset);
      meta.offset = st.size;

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
  const list = [];
  for (const [id, s] of sessions) {
    if (s.isSubagent) continue;
    if (projectFilter && s.projectName !== projectFilter) continue;
    list.push({ sessionId: id, projectName: s.projectName, messageCount: s.messages.length });
  }
  return list.sort((a, b) => b.messageCount - a.messageCount);
}

function getProjectMessages(projectName, before, limit) {
  const allMsgs = [];
  for (const [sid, s] of sessions) {
    if (s.projectName !== projectName) continue;
    for (const m of s.messages) {
      allMsgs.push({...m, _sid: sid});
    }
  }
  // Sort oldest first
  allMsgs.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

  if (before) {
    // Return messages older than 'before', take the newest of those (last N)
    const older = allMsgs.filter(m => m.timestamp < before);
    return older.slice(Math.max(0, older.length - limit));
  }
  // No 'before': return the last (newest) N messages
  return allMsgs.slice(Math.max(0, allMsgs.length - limit));
}

function listProjects() {
  const projects = new Map();
  for (const [id, s] of sessions) {
    if (s.isSubagent) continue;
    if (!projects.has(s.projectName)) {
      projects.set(s.projectName, { name: s.projectName, sessionCount: 0, totalMessages: 0 });
    }
    const p = projects.get(s.projectName);
    p.sessionCount++;
    p.totalMessages += s.messages.length;
  }
  return [...projects.values()].sort((a, b) => b.totalMessages - a.totalMessages);
}

// ── Read JSON body helper ───────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve(null); }
    });
  });
}

// ── HTTP + SSE server ───────────────────────────────────
function isLocalRequest(req) {
  const host = (req.headers.host || "").toLowerCase();
  return host === `localhost:${PORT}` || host === `127.0.0.1:${PORT}` || host === `[::1]:${PORT}`;
}

let detectedPublicOrigin = process.env.CC_WATCH_PUBLIC_URL || null; // e.g. https://xxx.ngrok-free.dev

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
    if (!body || !body.project) {
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
      console.log(`  Share revoked: ${t}`);
      res.writeHead(204);
      res.end();
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "token not found" }));
    }
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
    req.on("close", () => { clients.delete(clientId); });
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

  // ── Serve frontend ────────────────────────────────────
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(FRONTEND_HTML);
});

// ── Frontend ────────────────────────────────────────────
const FRONTEND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CC Watch</title>
<style>
  :root{--bg:#0a0a0a;--surface:#141414;--border:#262626;--text:#e5e5e5;--dim:#737373;--muted:#525252;--blue:#3b82f6;--blue-dim:#1e3a5f;--green:#22c55e;--yellow:#eab308;--red:#ef4444;--purple:#a78bfa;--orange:#f97316;--mono:'SF Mono','Fira Code','Menlo',monospace}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;line-height:1.6}
  .app{display:flex;height:100vh}
  .sidebar{width:280px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
  .sidebar-hd{padding:16px;border-bottom:1px solid var(--border)}
  .sidebar-hd h1{font-size:14px;color:var(--blue);font-weight:600;letter-spacing:.5px}
  .sidebar-hd .status{font-size:11px;color:var(--green);margin-top:4px;display:flex;align-items:center;gap:6px}
  .sidebar-hd .dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .slist{flex:1;overflow-y:auto;padding:8px}
  .pitem{padding:10px 12px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;transition:all .15s;display:flex;align-items:center;justify-content:space-between}
  .pitem:hover{background:var(--border)}
  .pitem.active{background:var(--blue-dim);border-color:var(--blue)}
  .pitem-info{flex:1;min-width:0}
  .pitem .pname{font-size:12px;word-break:break-all}
  .pitem .pmeta{font-size:10px;color:var(--dim);margin-top:2px}
  .share-btn{font-size:10px;background:var(--border);border:1px solid var(--dim);color:var(--dim);padding:2px 8px;border-radius:3px;cursor:pointer;flex-shrink:0;margin-left:8px}
  .share-btn:hover{color:var(--green);border-color:var(--green)}
  .main{flex:1;display:flex;flex-direction:column;min-width:0}
  .main-hd{padding:12px 20px;border-bottom:1px solid var(--border);background:var(--surface)}
  .main-hd .title{font-size:13px}
  .main-hd .path{font-size:11px;color:var(--dim)}
  .msgs{flex:1;overflow-y:auto;padding:20px;scroll-behavior:smooth}
  .empty{display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:14px;text-align:center}
  .msg{margin-bottom:16px;max-width:900px}
  .msg-role{font-size:10px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:600}
  .msg-role.user{color:var(--blue)}.msg-role.assistant{color:var(--green)}.msg-role.system{color:var(--yellow)}
  .msg-body{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px}
  .msg.user .msg-body{border-left:3px solid var(--blue)}
  .msg.assistant .msg-body{border-left:3px solid var(--green)}
  .msg-text{white-space:pre-wrap;word-break:break-word}
  .msg-thinking{color:var(--dim);font-style:italic;font-size:12px}
  .msg-thinking::before{content:"\\\\1F4AD  "}
  .tool-call{margin:8px 0;padding:8px 12px;background:rgba(167,139,250,.08);border-left:3px solid var(--purple);border-radius:4px;font-size:12px}
  .tool-call .tname{color:var(--purple);font-weight:600}
  .tool-call .targs{color:var(--dim);margin-top:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:hidden}
  .tool-result{margin:8px 0;padding:8px 12px;background:rgba(249,115,22,.06);border-left:3px solid var(--orange);border-radius:4px;font-size:11px;color:var(--dim);white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:hidden}
  .model-tag{display:inline-block;font-size:10px;color:var(--muted);background:var(--border);padding:1px 6px;border-radius:3px;margin-left:8px}
  .ts{font-size:10px;color:var(--muted);margin-top:4px}
  .session-divider{margin:20px 0;padding:8px 0;border-top:1px dashed var(--border);font-size:10px;color:var(--muted);text-align:center}
  .load-more-btn{padding:12px;text-align:center;color:var(--blue);cursor:pointer;font-size:12px;border:1px dashed var(--border);border-radius:6px;margin:8px 0}
  .load-more-btn:hover{background:var(--border)}
  .scroll-nav{position:fixed;right:24px;z-index:50;width:36px;height:36px;border-radius:50%;background:var(--surface);border:1px solid var(--border);color:var(--dim);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:all .2s;opacity:0;pointer-events:none}
  .scroll-nav.visible{opacity:1;pointer-events:auto}
  .scroll-nav:hover{background:var(--border);color:var(--text)}
  .scroll-nav.to-top{bottom:24px}
  .scroll-nav.to-bottom{bottom:68px}
  .modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:100}
  .modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:480px;width:90%}
  .modal h2{font-size:14px;color:var(--blue);margin-bottom:16px}
  .modal .share-url{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:10px 12px;font-family:var(--mono);font-size:12px;color:var(--green);word-break:break-all;margin:12px 0}
  .modal .btn-row{display:flex;gap:8px;margin-top:16px;justify-content:flex-end}
  .modal button{padding:6px 16px;border-radius:6px;border:1px solid var(--border);background:var(--border);color:var(--text);cursor:pointer;font-family:var(--mono);font-size:12px}
  .modal button:hover{border-color:var(--blue)}
  .modal button.primary{background:var(--blue);border-color:var(--blue);color:#fff}
  .modal button.primary:hover{background:#2563eb}
  .modal .hint{font-size:11px;color:var(--dim);margin-top:8px}
  .shares-panel{border-top:1px solid var(--border);padding:8px;max-height:200px;overflow-y:auto}
  .shares-panel .sh-title{font-size:10px;color:var(--dim);padding:4px 8px;text-transform:uppercase;letter-spacing:.5px}
  .share-item{display:flex;align-items:center;justify-content:space-between;padding:4px 8px;font-size:11px}
  .share-item .sh-proj{color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .share-item .sh-token{color:var(--dim);font-size:10px;margin:0 8px}
  .revoke-btn{font-size:10px;background:none;border:1px solid var(--red);color:var(--red);padding:1px 6px;border-radius:3px;cursor:pointer}
  .revoke-btn:hover{background:var(--red);color:#fff}
  @media(max-width:768px){.sidebar{width:200px}}
</style>
</head>
<body>
<div class="app">
  <div class="sidebar" id="sidebar">
    <div class="sidebar-hd">
      <h1>CC WATCH</h1>
      <div class="status"><span class="dot" id="dot"></span><span id="status">Connecting...</span></div>
    </div>
    <div class="slist" id="slist"></div>
    <div class="shares-panel" id="sharesPanel" style="display:none">
      <div class="sh-title">Active Shares</div>
      <div id="sharesList"></div>
    </div>
  </div>
  <div class="main">
    <div class="main-hd">
      <div class="title" id="title">Select a project</div>
      <div class="path" id="path"></div>
    </div>
    <div class="msgs" id="msgs"><div class="empty">Select a project to view sessions</div></div>
    <button class="scroll-nav to-top" id="scrollToTop" aria-label="Scroll to top" onclick="document.getElementById('msgs').scrollTop=0">&#8593;</button>
    <button class="scroll-nav to-bottom" id="scrollToBottom" aria-label="Scroll to bottom" onclick="document.getElementById('msgs').scrollTop=document.getElementById('msgs').scrollHeight">&#8595;</button>
  </div>
</div>
<div id="modal" class="modal-overlay" style="display:none">
  <div class="modal">
    <h2 id="modalTitle">Share Project</h2>
    <div id="modalBody"></div>
    <div class="btn-row">
      <button onclick="closeModal()">Close</button>
      <button id="modalCopyBtn" class="primary" onclick="copyShareUrl()">Copy URL</button>
    </div>
  </div>
</div>
<script>
const sessions = new Map();
let activeProject = null;
let loadedBefore = null;
let hasMoreHistory = true;
let isShareView = false;
let shareProject = null;
let currentShareUrl = "";
let publicOrigin = null; // set by SSE event from server

function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}

function getSSEUrl(){
  const params = new URLSearchParams(window.location.search);
  const t = params.get('t');
  return '/events' + (t ? '?t=' + encodeURIComponent(t) : '');
}

function connect(){
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
    if (activeProject) renderProject();
  });
  es.addEventListener('session-new', e => {
    const s = JSON.parse(e.data);
    sessions.set(s.sessionId, {...s, messages:[]});
    renderList();
    // Auto-select if this project is active
    if (activeProject === s.projectName) renderProject();
  });
  es.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    const s = sessions.get(m.sessionId);
    if(!s) return;
    s.messages.push(m);
    if(s.messages.length>500) s.messages=s.messages.slice(-300);
    renderList();
    if(activeProject && s.projectName === activeProject) appendMsg(m);
  });
  es.addEventListener('share-info', e => {
    const info = JSON.parse(e.data);
    if (info.error) {
      document.getElementById('title').textContent = 'Access Denied';
      document.getElementById('msgs').innerHTML = '<div class="empty">No access. A valid share token is required.</div>';
      return;
    }
    isShareView = true;
    shareProject = info.project;
    activeProject = info.project;
    renderList();
    renderProject();
  });
  es.addEventListener('public-origin', e => {
    publicOrigin = e.data;
    // SSE data is JSON.stringify'd, so strings arrive quoted
    try { publicOrigin = JSON.parse(publicOrigin); } catch {}
  });
  es.onerror=()=>{document.getElementById('status').textContent='Reconnecting...';document.getElementById('dot').style.background='var(--red)'};
  es.onopen=()=>{document.getElementById('status').textContent='Connected';document.getElementById('dot').style.background='var(--green)';renderList()};
}

function getProjects(){
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

function renderList(){
  const el = document.getElementById('slist');
  const projects = getProjects();
  el.innerHTML = '';
  for (const [proj, info] of projects) {
    const d = document.createElement('div');
    d.className = 'pitem' + (proj === activeProject ? ' active' : '');
    let inner = '<div class="pitem-info"><div class="pname">' + esc(proj) + '</div><div class="pmeta">' + info.sessionCount + ' sessions &middot; ' + info.totalMessages + ' msgs</div></div>';
    if (!isShareView) {
      inner += '<button class="share-btn" onclick="event.stopPropagation();createShare(\\''+esc(proj).replace(/'/g,"\\\\'")+'\\')">Share</button>';
    }
    d.innerHTML = inner;
    d.onclick = () => selectProject(proj);
    el.appendChild(d);
  }
  if (!isShareView) loadShares();
}

function selectProject(proj){
  activeProject = proj;
  loadedBefore = null;
  hasMoreHistory = true;
  document.getElementById('title').textContent = proj;
  document.getElementById('path').textContent = '';
  renderList();
  loadMessages();
}

async function loadMessages(){
  const el = document.getElementById('msgs');
  const isFirstPage = !loadedBefore;
  if (isFirstPage) el.innerHTML = '';
  const params = new URLSearchParams({project: activeProject, limit: 50});
  if (loadedBefore) params.set('before', loadedBefore);
  try {
    const r = await fetch('/api/project-messages?' + params);
    const msgs = await r.json();
    if (!msgs.length) { hasMoreHistory = false; if (!el.children.length || el.querySelector('.empty')) el.innerHTML = '<div class="empty">No messages yet</div>'; return; }
    const existingBtn = el.querySelector('.load-more-btn');
    if (existingBtn) existingBtn.remove();
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
    // Track oldest message timestamp for next page
    const oldestTs = msgs[0].timestamp;
    // Insert messages at top of container
    el.insertBefore(fragment, el.firstChild);
    // Add load-more at very top if there might be more
    if (msgs.length >= 50) {
      const btn = document.createElement('div');
      btn.className = 'load-more-btn';
      btn.textContent = 'Load more...';
      btn.onclick = () => { loadMessages(); };
      el.insertBefore(btn, el.firstChild);
    } else {
      hasMoreHistory = false;
    }
    // Set cursor for next page
    loadedBefore = oldestTs;
    // First page: scroll to bottom to show newest
    if (isFirstPage) el.scrollTop = el.scrollHeight;
  } catch {}
}

function appendMsg(m){
  const el = document.getElementById('msgs');
  const e = el.querySelector('.empty'); if (e) e.remove();
  el.appendChild(createMsgEl(m));
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
}

function createMsgEl(m){
  const d = document.createElement('div');
  d.className = 'msg ' + (m.role || 'system');
  let h = '';
  if (m.display) {
    if (m.display.type === 'text') h = '<div class="msg-text">' + esc(m.display.text) + '</div>';
    else if (m.display.type === 'summary') h = '<div class="msg-text" style="color:var(--yellow)">' + esc(m.display.text) + '</div>';
    else if (m.display.type === 'blocks') {
      (m.display.parts || []).forEach(p => {
        if (p.type === 'text') h += '<div class="msg-text">' + esc(p.text) + '</div>';
        else if (p.type === 'thinking') h += '<div class="msg-thinking">' + esc(p.text) + '</div>';
        else if (p.type === 'tool_use') h += '<div class="tool-call"><span class="tname">' + esc(p.toolName) + '</span><div class="targs">' + esc(p.args) + '</div></div>';
        else if (p.type === 'tool_result') h += '<div class="tool-result">' + esc(p.text) + '</div>';
      });
      if (m.display.model) h += '<span class="model-tag">' + esc(m.display.model) + '</span>';
    }
  }
  if (!h) { d.style.display = 'none'; return d; }
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
  d.innerHTML = '<div class="msg-role ' + (m.role || 'system') + '">' + (m.role || 'system') + '</div><div class="msg-body">' + h + '</div>' + (ts ? '<div class="ts">' + ts + '</div>' : '');
  return d;
}

function appendMsg(m){
  const el = document.getElementById('msgs');
  const e = el.querySelector('.empty'); if (e) e.remove();
  const d = document.createElement('div');
  d.className = 'msg ' + (m.role || 'system');
  let h = '';
  if (m.display) {
    if (m.display.type === 'text') h = '<div class="msg-text">' + esc(m.display.text) + '</div>';
    else if (m.display.type === 'summary') h = '<div class="msg-text" style="color:var(--yellow)">' + esc(m.display.text) + '</div>';
    else if (m.display.type === 'blocks') {
      (m.display.parts || []).forEach(p => {
        if (p.type === 'text') h += '<div class="msg-text">' + esc(p.text) + '</div>';
        else if (p.type === 'thinking') h += '<div class="msg-thinking">' + esc(p.text) + '</div>';
        else if (p.type === 'tool_use') h += '<div class="tool-call"><span class="tname">' + esc(p.toolName) + '</span><div class="targs">' + esc(p.args) + '</div></div>';
        else if (p.type === 'tool_result') h += '<div class="tool-result">' + esc(p.text) + '</div>';
      });
      if (m.display.model) h += '<span class="model-tag">' + esc(m.display.model) + '</span>';
    }
  }
  if (!h) return;
  const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '';
  d.innerHTML = '<div class="msg-role ' + (m.role || 'system') + '">' + (m.role || 'system') + '</div><div class="msg-body">' + h + '</div>' + (ts ? '<div class="ts">' + ts + '</div>' : '');
  el.appendChild(d);
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) el.scrollTop = el.scrollHeight;
}

async function createShare(project) {
  try {
    const r = await fetch('/api/shares', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project }) });
    const data = await r.json();
    if (!r.ok) { alert('Error: ' + data.error); return; }
    const origin = publicOrigin || window.location.origin;
    currentShareUrl = origin + data.url;
    document.getElementById('modalTitle').textContent = 'Share: ' + project;
    document.getElementById('modalBody').innerHTML = '<div class="hint">Share this URL to let others view this project\\'s sessions:</div><div class="share-url" id="shareUrlText">' + esc(currentShareUrl) + '</div><div class="hint">The project name is not visible in the URL. Revoke at any time from the sidebar.</div>';
    document.getElementById('modal').style.display = 'flex';
  } catch (e) { alert('Failed to create share: ' + e.message); }
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

function copyShareUrl() {
  navigator.clipboard.writeText(currentShareUrl).then(() => {
    document.getElementById('modalCopyBtn').textContent = 'Copied!';
    setTimeout(() => { document.getElementById('modalCopyBtn').textContent = 'Copy URL'; }, 2000);
  });
}

async function loadShares() {
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
      d.innerHTML = '<span class="sh-proj">' + esc(s.project) + '</span><span class="sh-token">' + s.token.slice(0, 8) + '...</span><button class="revoke-btn" onclick="revokeShare(\\'' + s.token + '\\')">Revoke</button>';
      list.appendChild(d);
    }
  } catch {}
}

async function revokeShare(token) {
  await fetch('/api/shares/' + token, { method: 'DELETE' });
  loadShares();
}

connect();

// Scroll navigation: show to-top at bottom, to-bottom at top
const msgsEl = document.getElementById('msgs');
const scrollBtnTop = document.getElementById('scrollToTop');
const scrollBtnBottom = document.getElementById('scrollToBottom');
msgsEl.addEventListener('scroll', () => {
  const { scrollTop, scrollHeight, clientHeight } = msgsEl;
  const atBottom = scrollHeight - scrollTop - clientHeight < 80;
  const atTop = scrollTop < 80;
  scrollBtnTop.classList.toggle('visible', atBottom && scrollTop > 80);
  scrollBtnBottom.classList.toggle('visible', atTop && scrollHeight - clientHeight > 80);
});
</script>
</body>
</html>`;

// ── Startup ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n  CC Watch running at http://localhost:${PORT}\n`);
  console.log("  Share publicly:");
  console.log(`  cloudflared tunnel --url http://localhost:${PORT}\n`);
  discoverAndWatch();
});

// Re-scan every 10s for new sessions
setInterval(discoverAndWatch, 10000);
