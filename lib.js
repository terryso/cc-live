// ── Pure functions extracted from server.js for testability ──

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
      valid.set(token, info);
    }
  }
  return valid;
}

export function extractDisplayMessage(raw, redactFn = redactSensitive) {
  const { type, uuid, timestamp, message, isSidechain, cwd } = raw;

  if (type === "summary") {
    return { uuid, timestamp, role: "system", display: { type: "summary", text: redactFn(message?.summary || "") }, isSidechain, cwd };
  }

  if (type === "user") {
    const content = message?.content;
    if (typeof content === "string") {
      if (content.startsWith("<local-command-caveat>")) return null;
      if (content.startsWith("<command-name>")) return null;
      if (content.startsWith("<local-command-")) return null;
      return { uuid, timestamp, role: "user", display: { type: "text", text: redactFn(content) }, isSidechain, cwd };
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
          hasNonToolResult = true;
          parts.push({ type: "text", text: redactFn(block.text) });
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
