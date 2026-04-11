// ── Pure functions extracted from server.js for testability ──

import { createHash, randomBytes } from "crypto";

// Password helpers
export function hashPassword(pwd) {
  return createHash("sha256").update(pwd).digest("hex");
}

export function generatePassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let pwd = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) pwd += chars[bytes[i] % chars.length];
  return pwd;
}

// JSONL parsing
export const SKIP_TYPES = new Set(["queue-operation", "file-history-snapshot", "change", "last-prompt"]);

// Hostname pattern for database connection string regex
const _DB_HOST = "(?:(?:[a-zA-Z0-9-]+\\.)+[a-zA-Z0-9-]+|localhost|\\d+\\.\\d+\\.\\d+\\.\\d+)";

// Sensitive data redaction patterns
export const BASE_SENSITIVE_PATTERNS = [
  // OpenAI / Anthropic API keys (sk-proj-xxx, sk-ant-xxx, sk-xxx)
  { pattern: /\bsk-(?:proj|ant|api)?-[A-Za-z0-9_-]{20,}/g, replacement: "sk-***REDACTED***" },
  // AWS Access Key IDs
  { pattern: /\b(AKIA)[A-Z0-9]{16}\b/g, replacement: "$1***REDACTED***" },
  // AWS Secret Access Keys (40-char base64 after known prefix patterns)
  { pattern: /\b(AWS(?:SecretAccessKey|_SECRET_ACCESS_KEY)\s*[=:]\s*)['"]?[A-Za-z0-9/+=]{40}['"]?/gi, replacement: "$1***REDACTED***" },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_)
  { pattern: /\bgh[opus]_[A-Za-z0-9]{36,}\b/g, replacement: "gh*_***REDACTED***" },
  // Slack tokens (xoxb-, xoxp-, xoxr-, xoxa-, xoxs-)
  { pattern: /\bxox[bpars]-[A-Za-z0-9-]{20,}/g, replacement: "xox*_***REDACTED***" },
  // Google API keys
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g, replacement: "AIza***REDACTED***" },
  // Bearer tokens (JWT-like: xxx.yyy.zzz)
  { pattern: /\b(Bearer\s+)[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "$1***REDACTED***" },
  // Generic secrets in assignment context (password=, secret=, api_key=, etc.)
  { pattern: /((?:password|passwd|secret|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?token)\s*[=:]\s*)['"]?[A-Za-z0-9!@#$%^&*()_+\-=[\]{};':",.<>?/\\|`~]{8,}/gi, replacement: "$1***REDACTED***" },
  // Generic TOKEN assignment
  { pattern: /((?:^|[\s"'`])(?:token|TOKEN)\s*[=:]\s*)['"]?[A-Za-z0-9_-]{16,}/gm, replacement: "$1***REDACTED***" },
  // PEM private keys (RSA, EC, OpenSSH, DSA, PGP)
  { pattern: /-----BEGIN\s+(?:(?:RSA|EC|OPENSSH|DSA|PGP)\s+)?PRIVATE\s+KEY(?:\s+BLOCK)?-----[\s\S]*?-----END\s+(?:(?:RSA|EC|OPENSSH|DSA|PGP)\s+)?PRIVATE\s+KEY(?:\s+BLOCK)?-----/g, replacement: "-----BEGIN REDACTED PRIVATE KEY-----" },
  // ── Database connection strings with embedded passwords ──
  // Handles passwords containing @ by matching to the @ before hostname
  // $1 = scheme+user:, $2 = password, $3 = @hostname
  // MongoDB: mongodb://user:pass@host or mongodb+srv://user:pass@host
  { pattern: new RegExp("(mongodb(?:\\+srv)?://[^:@\\s]+:)(.+)(@" + _DB_HOST + ")", "g"), replacement: "$1***REDACTED***$3" },
  // PostgreSQL: postgres://user:pass@host or postgresql://user:pass@host
  { pattern: new RegExp("(postgres(?:ql)?://[^:@\\s]+:)(.+)(@" + _DB_HOST + ")", "g"), replacement: "$1***REDACTED***$3" },
  // MySQL: mysql://user:pass@host
  { pattern: new RegExp("(mysql(?:2)?://[^:@\\s]+:)(.+)(@" + _DB_HOST + ")", "g"), replacement: "$1***REDACTED***$3" },
  // Redis: redis://:pass@host
  { pattern: new RegExp("(redis?://:)(.+)(@" + _DB_HOST + ")", "g"), replacement: "$1***REDACTED***$3" },
  // JDBC connection strings: jdbc:postgresql://user:pass@host
  { pattern: new RegExp("(jdbc:[a-z]+://[^:@\\s]+:)(.+)(@" + _DB_HOST + ")", "g"), replacement: "$1***REDACTED***$3" },
  // ── Stripe ──
  // Stripe secret keys (sk_live_, sk_test_)
  { pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}/g, replacement: "sk_***REDACTED***" },
  // Stripe publishable keys (pk_live_, pk_test_)
  { pattern: /\bpk_(?:live|test)_[A-Za-z0-9]{24,}/g, replacement: "pk_***REDACTED***" },
  // Stripe webhook secrets (whsec_)
  { pattern: /\bwhsec_[A-Za-z0-9]{20,}/g, replacement: "whsec_***REDACTED***" },
  // ── Messaging / Bot tokens ──
  // Telegram bot token (digits:alphanumeric)
  { pattern: /\b(\d{8,10}:[A-Za-z0-9_-]{30,})\b/g, replacement: "***TELEGRAM_REDACTED***" },
  // Discord bot token (number.base64.token)
  { pattern: /\bMTIz[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "***DISCORD_REDACTED***" },
  // ── Platform tokens ──
  // Vercel tokens (vrtx_)
  { pattern: /\bvrtx_[A-Za-z0-9]{20,}/g, replacement: "vrtx_***REDACTED***" },
  // PyPI tokens (pypi- prefix)
  { pattern: /\bpypi-[A-Za-z0-9_]{20,}/g, replacement: "pypi-***REDACTED***" },
  // Cloudflare API tokens (40-char hex after assignment)
  { pattern: /(CLOUDFLARE(?:_API)?(?:_TOKEN)?\s*[=:]\s*)['"]?[A-Za-z0-9_-]{30,}['"]?/gi, replacement: "$1***REDACTED***" },
];

// Load custom redaction rules from CC_LIVE_REDACT_<N> env vars
export function loadCustomPatterns(env) {
  const patterns = [];
  for (let i = 1; ; i++) {
    const val = env[`CC_LIVE_REDACT_${i}`];
    if (!val) break;
    if (val.startsWith("/") && val.includes("→")) {
      const sep = val.lastIndexOf("/");
      const regexStr = val.slice(1, sep);
      const replacement = val.slice(sep + 1).replace(/^→/, "");
      const flags = regexStr.match(/\/([gimsuy]*)$/);
      const patternStr = flags ? regexStr.slice(0, regexStr.length - flags[0].length) : regexStr;
      const flagStr = flags ? flags[1] : "g";
      try {
        patterns.push({ pattern: new RegExp(patternStr, flagStr), replacement });
      } catch {}
    } else {
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      patterns.push({ pattern: new RegExp(escaped, "g"), replacement: "***REDACTED***" });
    }
  }
  return patterns;
}

export function redactSensitive(text, patterns = BASE_SENSITIVE_PATTERNS) {
  if (!text || typeof text !== "string") return text;
  for (const { pattern, replacement } of patterns) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

export function parseLine(line) {
  try {
    const obj = JSON.parse(line);
    if (SKIP_TYPES.has(obj.type)) return null;
    return obj;
  } catch { return null; }
}

// Validate share token entries from persisted JSON
export function validateShareTokenEntries(entries) {
  const valid = new Map();
  for (const [token, info] of Object.entries(entries)) {
    if (typeof token === "string" && info && typeof info.project === "string" && typeof info.createdAt === "number") {
      valid.set(token, { project: info.project, createdAt: info.createdAt, passwordHash: info.passwordHash || null });
    }
  }
  return valid;
}

/**
 * Process user message text — handles command tags, skill invocations, and system boilerplate.
 * Returns null to skip, or { type, ...data } for structured display.
 * Modeled after claude-history's process_command_message().
 */
function processUserText(text) {
  const t = text.trim();

  // <local-command-caveat>...</local-command-caveat> — system wrapper, skip entirely
  if (t.startsWith("<local-command-caveat>") && t.endsWith("</local-command-caveat>")) return null;

  // <local-command-clear>...</local-command-clear> — clear screen, skip entirely
  if (t.startsWith("<local-command-clear>") && t.endsWith("</local-command-clear>")) return null;

  // <local-command-stdout>...</local-command-stdout> — skip if empty, show content if non-empty
  if (t.startsWith("<local-command-stdout>") && t.endsWith("</local-command-stdout>")) {
    const inner = t.slice("<local-command-stdout>".length, t.length - "</local-command-stdout>".length).trim();
    return inner || null;
  }

  // <command-name>/cmd</command-name> with optional <command-args>...</command-args>
  const cmdStart = t.indexOf("<command-name>");
  const cmdEnd = t.indexOf("</command-name>");
  if (cmdStart !== -1 && cmdEnd !== -1 && cmdStart < cmdEnd) {
    const cmdName = t.slice(cmdStart + "<command-name>".length, cmdEnd).trim();
    if (cmdName === "/clear") return null;
    const argsStart = t.indexOf("<command-args>");
    const argsEnd = t.indexOf("</command-args>");
    if (argsStart !== -1 && argsEnd !== -1 && argsStart < argsEnd) {
      const args = t.slice(argsStart + "<command-args>".length, argsEnd).trim();
      return { type: "command", name: cmdName, args };
    }
    return { type: "command", name: cmdName, args: "" };
  }

  // "Base directory for this skill:" — skill prompt expansion, skip entirely
  // (the preceding command message already shows the skill name + args)
  if (t.startsWith("Base directory for this skill:")) return null;

  // Pass through normal text unchanged
  return text;
}

// ── Server pure data functions (extracted for testability) ──

export function listSessions(sessions, projectFilter) {
  const list = [];
  for (const [id, s] of sessions) {
    if (s.isSubagent) continue;
    if (projectFilter && s.projectName !== projectFilter) continue;
    list.push({ sessionId: id, projectName: s.projectName, messageCount: s.messages.length });
  }
  return list.sort((a, b) => b.messageCount - a.messageCount);
}

export function getProjectMessages(sessions, projectName, before, limit) {
  const allMsgs = [];
  for (const [sid, s] of sessions) {
    if (s.projectName !== projectName) continue;
    for (const m of s.messages) {
      allMsgs.push({ ...m, _sid: sid });
    }
  }
  // Sort oldest first
  allMsgs.sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));

  if (before) {
    const older = allMsgs.filter(m => m.timestamp < before);
    return older.slice(Math.max(0, older.length - limit));
  }
  return allMsgs.slice(Math.max(0, allMsgs.length - limit));
}

export function listProjects(sessions) {
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

export function computeProjectStats(sessions, projectName, now = Date.now()) {
  const toolCounts = {};
  const files = new Set();
  let totalMessages = 0;
  let totalToolCalls = 0;
  let thinkingCount = 0;
  let userModel = "";
  const timeline = new Array(30).fill(0);
  const timelineTools = new Array(30).fill(0);
  let recentCount = 0;
  let firstTs = Infinity;
  let lastTs = 0;

  for (const [, s] of sessions) {
    if (s.projectName !== projectName) continue;
    for (const m of s.messages) {
      totalMessages++;
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      if (ts > 0) {
        if (ts < firstTs) firstTs = ts;
        if (ts > lastTs) lastTs = ts;
        const minsAgo = Math.floor((now - ts) / 60000);
        if (minsAgo >= 0 && minsAgo < 30) timeline[29 - minsAgo]++;
        if (ts > now - 60000) recentCount++;
      }
      if (m.display?.type === "blocks" && Array.isArray(m.display.parts)) {
        for (const p of m.display.parts) {
          if (p.type === "tool_use") {
            totalToolCalls++;
            const name = p.toolName || "unknown";
            toolCounts[name] = (toolCounts[name] || 0) + 1;
            if (p.args) {
              try {
                const args = JSON.parse(p.args);
                if (args.file_path) files.add(args.file_path);
              } catch {}
            }
            if (ts > 0) {
              const minsAgo = Math.floor((now - ts) / 60000);
              if (minsAgo >= 0 && minsAgo < 30) timelineTools[29 - minsAgo]++;
            }
          }
          if (p.type === "thinking") thinkingCount++;
        }
        if (m.role === "assistant" && m.display.model) userModel = m.display.model;
      }
    }
  }

  const topTools = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const durationMs = (firstTs < Infinity && lastTs > 0) ? lastTs - firstTs : 0;

  return {
    totalMessages,
    totalToolCalls,
    filesTouched: files.size,
    thinkingCount,
    durationMs,
    velocity: recentCount,
    model: userModel,
    timeline,
    timelineTools,
    topTools,
    topToolMax: topTools.length ? topTools[0][1] : 1,
  };
}

// ── Dashboard pure functions ──

export function formatDuration(ms) {
  if (ms <= 0) return "0m";
  const mins = Math.floor(ms / 60000);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return hrs + "h " + (mins % 60) + "m";
  return mins + "m";
}

export function formatModel(m) {
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

export function extractDisplayMessage(raw, redactFn = redactSensitive) {
  const { type, uuid, timestamp, message, isSidechain, cwd } = raw;

  if (type === "summary") {
    return { uuid, timestamp, role: "system", display: { type: "summary", text: redactFn(message?.summary || "") }, isSidechain, cwd };
  }

  if (type === "user") {
    const content = message?.content;
    if (typeof content === "string") {
      const processed = processUserText(content);
      if (processed === null) return null;
      if (typeof processed === "string") {
        return { uuid, timestamp, role: "user", display: { type: "text", text: redactFn(processed) }, isSidechain, cwd };
      }
      // Structured result (command)
      return { uuid, timestamp, role: "user", display: processed, isSidechain, cwd };
    }
    if (Array.isArray(content)) {
      const parts = [];
      let hasNonToolResult = false;
      for (const block of content) {
        if (block.type === "tool_result") {
          const text = typeof block.content === "string" ? block.content
            : Array.isArray(block.content) ? block.content.map(c => c.type === "text" ? c.text : c.type === "tool_reference" ? `[${c.tool_name}]` : "").join("\n")
            : JSON.stringify(block.content);
          parts.push({ type: "tool_result", toolUseId: block.tool_use_id, text: redactFn(text) });
        } else if (block.type === "text") {
          const processed = processUserText(block.text);
          if (processed === null) continue;
          hasNonToolResult = true;
          if (typeof processed === "string") {
            parts.push({ type: "text", text: redactFn(processed) });
          } else {
            // Structured result from array text block
            parts.push(processed);
          }
        }
      }
      if (!parts.length) return null;
      const role = hasNonToolResult ? "user" : "tool_response";
      return { uuid, timestamp, role, display: { type: "blocks", parts }, isSidechain, cwd };
    }
    return null;
  }

  if (type === "assistant") {
    const content = message?.content;
    if (!Array.isArray(content)) return null;
    const parts = [];
    for (const block of content) {
      if (block.type === "text") parts.push({ type: "text", text: redactFn(block.text) });
      else if (block.type === "thinking") parts.push({ type: "thinking", text: redactFn(block.thinking) });
      else if (block.type === "tool_use") {
        parts.push({ type: "tool_use", toolName: block.name, toolCallId: block.id, args: redactFn(JSON.stringify(block.input)) });
      }
    }
    if (!parts.length) return null;
    return { uuid, timestamp, role: "assistant", display: { type: "blocks", parts, model: message?.model || "" }, isSidechain, cwd };
  }
  return null;
}
