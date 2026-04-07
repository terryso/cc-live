import { createServer } from "http";
import { readFile, stat, readdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

// ── Config ──────────────────────────────────────────────
const PORT = process.env.CC_WATCH_PORT || 3456;
const CLAUDE_DIR = process.env.CLAUDE_DIR || join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");
const MAX_WATCHED = 20; // only watch this many recent files
const HISTORY_LOAD = 100; // messages to load from history

// ── State ───────────────────────────────────────────────
const clients = new Map();
const watchedFiles = new Map(); // filepath -> { offset, sessionId, interval }
const sessions = new Map(); // sessionId -> { meta, messages[], active }

// ── SSE helpers ─────────────────────────────────────────
function sseSend(res, event, data) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const [, res] of clients) sseSend(res, event, data);
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

// ── Session file discovery (with mtime sorting) ─────────
async function findRecentSessionFiles(limit) {
  const files = [];
  try {
    const dirs = await readdir(PROJECTS_DIR);
    for (const dir of dirs) {
      const dirPath = join(PROJECTS_DIR, dir);
      let st;
      try { st = await stat(dirPath); if (!st.isDirectory()) continue; } catch { continue; }

      const projectName = dir.replace(/^-/, "").replace(/-/g, "/").replace(/^\//, "");
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) {
          const fullPath = join(dirPath, entry);
          try {
            const fst = await stat(fullPath);
            files.push({ path: fullPath, sessionId: entry.replace(".jsonl", ""), projectName, mtime: fst.mtimeMs, size: fst.size, isSubagent: false });
          } catch {}
        }
      }
    }
  } catch (e) { console.error("Scan error:", e.message); }

  // Sort by modification time, most recent first
  files.sort((a, b) => b.mtime - a.mtime);
  return files.slice(0, limit);
}

// ── Watch a single file for new content ─────────────────
function watchFile(filePath, sessionId, projectName, fromOffset) {
  if (watchedFiles.has(filePath)) return;

  const meta = { offset: fromOffset, sessionId, projectName, isSubagent: false };
  watchedFiles.set(filePath, meta);

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { projectName, isSubagent: false, messages: [], active: true });
    broadcast("session-new", { sessionId, projectName, isSubagent: false });
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
        broadcast("message", { sessionId, ...msg });
      }
    } catch {}
  }, 500);

  console.log(`  Watching: ${projectName || sessionId.slice(0, 8)}`);
}

// ── Load history from a JSONL file (for on-demand viewing) ──
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

// ── Discover & watch recent files ───────────────────────
let lastScanCount = 0;
async function discoverAndWatch() {
  const files = await findRecentSessionFiles(MAX_WATCHED);

  // Watch new files that appeared in recent scan
  for (const f of files) {
    if (!watchedFiles.has(f.path)) {
      // Start from end of file (only new content)
      watchFile(f.path, f.sessionId, f.projectName, f.size);
    }
  }

  if (files.length !== lastScanCount) {
    lastScanCount = files.length;
    console.log(`Tracking ${files.length} recent sessions`);
  }
}

// ── API helpers ─────────────────────────────────────────
function listSessions() {
  const list = [];
  for (const [id, s] of sessions) {
    if (s.isSubagent) continue;
    list.push({ sessionId: id, projectName: s.projectName, messageCount: s.messages.length });
  }
  return list.sort((a, b) => b.messageCount - a.messageCount);
}

// ── HTTP + SSE server ───────────────────────────────────
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS for all
  res.setHeader("Access-Control-Allow-Origin", "*");

  // SSE endpoint
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    clients.set(clientId, res);
    console.log(`Client connected: ${clientId} (${clients.size} total)`);
    sseSend(res, "sessions", listSessions());
    req.on("close", () => { clients.delete(clientId); });
    return;
  }

  // API: list sessions
  if (url.pathname === "/api/sessions") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listSessions()));
    return;
  }

  // API: session history (on-demand load from file)
  const sessionMatch = url.pathname.match(/^\/api\/session\/(.+)$/);
  if (sessionMatch) {
    const sid = sessionMatch[1];
    const session = sessions.get(sid);
    if (session && session.messages.length > 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessionId: sid, projectName: session.projectName, messages: session.messages }));
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
    return;
  }

  // Serve frontend
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
  :root {
    --bg:#0a0a0a;--surface:#141414;--border:#262626;
    --text:#e5e5e5;--dim:#737373;--muted:#525252;
    --blue:#3b82f6;--blue-dim:#1e3a5f;
    --green:#22c55e;--yellow:#eab308;--red:#ef4444;
    --purple:#a78bfa;--orange:#f97316;
    --mono:'SF Mono','Fira Code','Menlo',monospace;
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--bg);color:var(--text);font-family:var(--mono);font-size:13px;line-height:1.6}
  .app{display:flex;height:100vh}

  .sidebar{width:260px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;flex-shrink:0}
  .sidebar-hd{padding:16px;border-bottom:1px solid var(--border)}
  .sidebar-hd h1{font-size:14px;color:var(--blue);font-weight:600;letter-spacing:.5px}
  .sidebar-hd .status{font-size:11px;color:var(--green);margin-top:4px;display:flex;align-items:center;gap:6px}
  .sidebar-hd .dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
  .slist{flex:1;overflow-y:auto;padding:8px}
  .sitem{padding:10px 12px;border-radius:6px;cursor:pointer;margin-bottom:4px;border:1px solid transparent;transition:all .15s}
  .sitem:hover{background:var(--border)}
  .sitem.active{background:var(--blue-dim);border-color:var(--blue)}
  .sitem .name{font-size:12px;word-break:break-all}
  .sitem .meta{font-size:10px;color:var(--dim);margin-top:2px}

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
  .msg-thinking::before{content:"\\1F4AD  "}
  .tool-call{margin:8px 0;padding:8px 12px;background:rgba(167,139,250,.08);border-left:3px solid var(--purple);border-radius:4px;font-size:12px}
  .tool-call .tname{color:var(--purple);font-weight:600}
  .tool-call .targs{color:var(--dim);margin-top:4px;font-size:11px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:hidden}
  .tool-result{margin:8px 0;padding:8px 12px;background:rgba(249,115,22,.06);border-left:3px solid var(--orange);border-radius:4px;font-size:11px;color:var(--dim);white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:hidden}
  .model-tag{display:inline-block;font-size:10px;color:var(--muted);background:var(--border);padding:1px 6px;border-radius:3px;margin-left:8px}
  .ts{font-size:10px;color:var(--muted);margin-top:4px}
  @media(max-width:768px){.sidebar{width:180px}}
</style>
</head>
<body>
<div class="app">
  <div class="sidebar">
    <div class="sidebar-hd">
      <h1>CC WATCH</h1>
      <div class="status"><span class="dot" id="dot"></span><span id="status">Connecting...</span></div>
    </div>
    <div class="slist" id="slist"></div>
  </div>
  <div class="main">
    <div class="main-hd">
      <div class="title" id="title">Select a session</div>
      <div class="path" id="path"></div>
    </div>
    <div class="msgs" id="msgs"><div class="empty">Scanning for active sessions...</div></div>
  </div>
</div>
<script>
const sessions = new Map();
let activeId = null;

function esc(s){return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}

function connect(){
  const es = new EventSource('/events');
  es.addEventListener('sessions', e => { JSON.parse(e.data).forEach(s => { if(!sessions.has(s.sessionId)) sessions.set(s.sessionId, {...s, messages:[]}); }); renderList(); });
  es.addEventListener('session-new', e => { const s=JSON.parse(e.data); sessions.set(s.sessionId,{...s,messages:[]}); renderList(); });
  es.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    const s = sessions.get(m.sessionId);
    if(!s) return;
    s.messages.push(m);
    if(s.messages.length>500) s.messages=s.messages.slice(-300);
    renderList();
    if(m.sessionId===activeId) appendMsg(m);
  });
  es.onerror=()=>{document.getElementById('status').textContent='Reconnecting...';document.getElementById('dot').style.background='var(--red)'};
  es.onopen=()=>{document.getElementById('status').textContent='Connected';document.getElementById('dot').style.background='var(--green)'};
}

function renderList(){
  const el=document.getElementById('slist');
  // Sort: active with messages first
  const sorted=[...sessions.entries()].filter(([,s])=>!s.isSubagent).sort((a,b)=>b[1].messages.length-a[1].messages.length);
  el.innerHTML='';
  for(const [id,s] of sorted){
    const d=document.createElement('div');
    d.className='sitem'+(id===activeId?' active':'');
    d.innerHTML='<div class="name">'+esc(s.projectName||id.slice(0,12))+'</div><div class="meta">'+s.messages.length+' msgs'+(s.active?' &middot; live':'')+'</div>';
    d.onclick=()=>selectSession(id);
    el.appendChild(d);
  }
}

function selectSession(id){
  activeId=id;
  const s=sessions.get(id);
  const el=document.getElementById('msgs');
  el.innerHTML='';
  if(s){
    document.getElementById('title').textContent=s.projectName||id.slice(0,12);
    document.getElementById('path').textContent=id.slice(0,24)+'...';
    s.messages.forEach(m=>appendMsg(m));
  }
  renderList();
  el.scrollTop=el.scrollHeight;
}

function appendMsg(m){
  const el=document.getElementById('msgs');
  const e=el.querySelector('.empty');if(e)e.remove();
  const d=document.createElement('div');
  d.className='msg '+(m.role||'system');
  let h='';
  if(m.display){
    if(m.display.type==='text') h='<div class="msg-text">'+esc(m.display.text)+'</div>';
    else if(m.display.type==='summary') h='<div class="msg-text" style="color:var(--yellow)">'+esc(m.display.text)+'</div>';
    else if(m.display.type==='blocks'){
      (m.display.parts||[]).forEach(p=>{
        if(p.type==='text') h+='<div class="msg-text">'+esc(p.text)+'</div>';
        else if(p.type==='thinking') h+='<div class="msg-thinking">'+esc(p.text)+'</div>';
        else if(p.type==='tool_use') h+='<div class="tool-call"><span class="tname">'+esc(p.toolName)+'</span><div class="targs">'+esc(p.args)+'</div></div>';
        else if(p.type==='tool_result') h+='<div class="tool-result">'+esc(p.text)+'</div>';
      });
      if(m.display.model) h+='<span class="model-tag">'+esc(m.display.model)+'</span>';
    }
  }
  if(!h) return;
  const ts=m.timestamp?new Date(m.timestamp).toLocaleTimeString():'';
  d.innerHTML='<div class="msg-role '+(m.role||'system')+'">'+(m.role||'system')+'</div><div class="msg-body">'+h+'</div>'+(ts?'<div class="ts">'+ts+'</div>':'');
  el.appendChild(d);
  if(el.scrollHeight-el.scrollTop-el.clientHeight<200) el.scrollTop=el.scrollHeight;
}

connect();
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
