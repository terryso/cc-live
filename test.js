import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitive, parseLine, extractDisplayMessage,
  validateShareTokenEntries,
  BASE_SENSITIVE_PATTERNS, loadCustomPatterns,
} from "./lib.js";
import { esc, isDiffContent, renderDiff, detectContentType } from "./public/js/utils.js";

// ── redactSensitive ──────────────────────────────────────

describe("redactSensitive", () => {
  it("returns non-string input unchanged", () => {
    assert.equal(redactSensitive(null), null);
    assert.equal(redactSensitive(undefined), undefined);
    assert.equal(redactSensitive(42), 42);
  });

  it("returns empty string unchanged", () => {
    assert.equal(redactSensitive(""), "");
  });

  it("returns clean text unchanged", () => {
    assert.equal(redactSensitive("hello world"), "hello world");
  });

  it("redacts OpenAI API keys", () => {
    const input = "my key is sk-proj-abc123def456ghi789jkl012mno345";
    const result = redactSensitive(input);
    assert.ok(!result.includes("sk-proj-abc"));
    assert.ok(result.includes("sk-***REDACTED***"));
  });

  it("redacts Anthropic API keys", () => {
    const input = "key: sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
    const result = redactSensitive(input);
    assert.ok(!result.includes("sk-ant-api03-"));
    assert.ok(result.includes("sk-***REDACTED***"));
  });

  it("redacts AWS Access Key IDs", () => {
    const input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = redactSensitive(input);
    assert.ok(result.includes("AKIA***REDACTED***"));
    assert.ok(!result.includes("AKIAIOSFODNN7EXAMPLE"));
  });

  it("redacts GitHub tokens", () => {
    const input = "token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn";
    const result = redactSensitive(input);
    assert.ok(result.includes("gh*_***REDACTED***"));
    assert.ok(!result.includes("ghp_ABCDEF"));
  });

  it("redacts Slack tokens", () => {
    const input = "SLACK_TOKEN=xoxb-AAAAAAAAAA-BBBBBBBBBB-CCCCCCCCCCCCCCCCCCCCCCCC";
    const result = redactSensitive(input);
    assert.ok(result.includes("xox*_***REDACTED***"));
    assert.ok(!result.includes("xoxb-"));
  });

  it("redacts Google API keys", () => {
    // Without assignment context, the AIza-specific pattern fires
    const input = "key is AIzaSyA1234567890abcdefghijklmnopqrstuv";
    const result = redactSensitive(input);
    assert.ok(result.includes("AIza***REDACTED***"));
    assert.ok(!result.includes("AIzaSyA1234567890"));
  });

  it("redacts Bearer JWT tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abcdef";
    const result = redactSensitive(input);
    assert.ok(result.includes("Bearer ***REDACTED***"));
    assert.ok(!result.includes("eyJhbGciOiJIUzI1NiJ9"));
  });

  it("redacts generic password assignments", () => {
    const input = 'password="supersecret123"';
    const result = redactSensitive(input);
    assert.ok(result.includes("password=***REDACTED***"));
    assert.ok(!result.includes("supersecret123"));
  });

  it("redacts api_key assignments", () => {
    const input = "api_key=myApiKey12345678";
    const result = redactSensitive(input);
    assert.ok(result.includes("api_key=***REDACTED***"));
    assert.ok(!result.includes("myApiKey12345678"));
  });

  it("redacts PEM private keys", () => {
    const input = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----";
    const result = redactSensitive(input);
    assert.equal(result, "-----BEGIN REDACTED PRIVATE KEY-----");
  });

  it("redacts multiple secrets in one string", () => {
    const input = "key1=sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaa and key2=sk-ant-bbbbbbbbbbbbbbbbbbbbbbbbbb";
    const result = redactSensitive(input);
    assert.ok(!result.includes("sk-proj-aaa"));
    assert.ok(!result.includes("sk-ant-bbb"));
    assert.ok(result.includes("sk-***REDACTED***"));
  });

  // ── Database connection strings ──

  it("redacts MongoDB connection string", () => {
    const result = redactSensitive("mongodb://admin:secretpass@cluster0.example.mongodb.net/mydb");
    assert.ok(!result.includes("secretpass"));
    assert.ok(result.includes("***REDACTED***"));
    assert.ok(result.includes("@cluster0.example.mongodb.net"));
  });

  it("redacts MongoDB connection string with @ in password", () => {
    const result = redactSensitive("mongodb://admin:S3cretP@ss@cluster0.example.mongodb.net/mydb");
    assert.ok(!result.includes("S3cretP"));
    assert.ok(result.includes("***REDACTED***"));
    assert.ok(result.includes("@cluster0.example.mongodb.net"));
  });

  it("redacts MongoDB SRV connection string", () => {
    const result = redactSensitive("mongodb+srv://admin:secretpass@cluster.mongodb.net/mydb");
    assert.ok(!result.includes("secretpass"));
    assert.ok(result.includes("@cluster.mongodb.net"));
  });

  it("does not redact MongoDB URL without password", () => {
    const input = "mongodb://localhost:27017/mydb";
    assert.equal(redactSensitive(input), input);
  });

  it("redacts PostgreSQL connection string", () => {
    const result = redactSensitive("postgres://user:p@ssw0rd@db.example.com:5432/myapp");
    assert.ok(!result.includes("p@ssw0rd"));
    assert.ok(result.includes("***REDACTED***"));
    assert.ok(result.includes("@db.example.com"));
  });

  it("redacts postgresql:// long form", () => {
    const result = redactSensitive("postgresql://admin:s3cret@localhost:5432/production");
    assert.ok(!result.includes("s3cret"));
    assert.ok(result.includes("@localhost"));
  });

  it("redacts MySQL connection string", () => {
    const result = redactSensitive("mysql://root:password123@localhost:3306/mydb");
    assert.ok(!result.includes("password123"));
    assert.ok(result.includes("@localhost"));
  });

  it("redacts Redis URL with password", () => {
    const result = redactSensitive("redis://:s3cret_password@redis.example.com:6379");
    assert.ok(!result.includes("s3cret_password"));
    assert.ok(result.includes("@redis.example.com"));
  });

  it("does not redact Redis URL without password", () => {
    const input = "redis://localhost:6379";
    assert.equal(redactSensitive(input), input);
  });

  it("redacts JDBC connection string", () => {
    const result = redactSensitive("jdbc:postgresql://user:password123@db.example.com:5432/mydb");
    assert.ok(!result.includes("password123"));
    assert.ok(result.includes("@db.example.com"));
  });

  // ── Stripe ── (prefix split to avoid GitHub push protection false positive)

  it("redacts Stripe live secret key", () => {
    const prefix = "sk" + "_live_"; // split to avoid secret scanner
    const result = redactSensitive(prefix + "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE");
    assert.ok(!result.includes("FAKEfake"));
    assert.ok(result.includes("sk_***REDACTED***"));
  });

  it("redacts Stripe test secret key", () => {
    const prefix = "sk" + "_test_";
    const result = redactSensitive(prefix + "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE");
    assert.ok(!result.includes("FAKEfake"));
    assert.ok(result.includes("sk_***REDACTED***"));
  });

  it("redacts Stripe publishable key", () => {
    const prefix = "pk" + "_live_";
    const result = redactSensitive(prefix + "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE");
    assert.ok(!result.includes("FAKEfake"));
    assert.ok(result.includes("pk_***REDACTED***"));
  });

  it("redacts Stripe webhook secret", () => {
    const prefix = "wh" + "sec_";
    const result = redactSensitive(prefix + "FAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE");
    assert.ok(!result.includes("FAKEfake"));
    assert.ok(result.includes("whsec_***REDACTED***"));
  });

  // ── Messaging / Bot tokens ──

  it("redacts Telegram bot token", () => {
    const result = redactSensitive("123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890ab");
    assert.ok(!result.includes("ABCdefGHI"));
    assert.ok(result.includes("***TELEGRAM_REDACTED***"));
  });

  it("redacts Discord bot token", () => {
    const result = redactSensitive("MTIzNDU2Nzg5MDEy.MTQ1Ng.GhXYZ_abc123def456ghi789jkl012mno345");
    assert.ok(!result.includes("MTIzNDU2"));
    assert.ok(result.includes("***DISCORD_REDACTED***"));
  });

  // ── Platform tokens ──

  it("redacts Vercel token", () => {
    const result = redactSensitive("vrtx_abc123def456ghi789jkl012mno345pqr678");
    assert.ok(!result.includes("abc123def"));
    assert.ok(result.includes("vrtx_***REDACTED***"));
  });

  it("redacts PyPI token", () => {
    const result = redactSensitive("pypi-AgEIcHlwS2VydkBtYWlsLmNvbQABCDEF123456");
    assert.ok(!result.includes("AgEIcHlw"));
    assert.ok(result.includes("pypi-***REDACTED***"));
  });

  it("redacts Cloudflare API token assignment", () => {
    const result = redactSensitive("CLOUDFLARE_API_TOKEN=abc123def456ghi789jkl012mno345pqr678stu");
    assert.ok(!result.includes("abc123def"));
    assert.ok(result.includes("***REDACTED***"));
  });

  // ── Private keys (expanded types) ──

  it("redacts OpenSSH private key", () => {
    const input = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----";
    assert.equal(redactSensitive(input), "-----BEGIN REDACTED PRIVATE KEY-----");
  });

  it("redacts EC private key", () => {
    const input = "-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIOBX\n-----END EC PRIVATE KEY-----";
    assert.equal(redactSensitive(input), "-----BEGIN REDACTED PRIVATE KEY-----");
  });

  it("redacts DSA private key", () => {
    const input = "-----BEGIN DSA PRIVATE KEY-----\nMIIBuwIBAAJBAK\n-----END DSA PRIVATE KEY-----";
    assert.equal(redactSensitive(input), "-----BEGIN REDACTED PRIVATE KEY-----");
  });

  it("redacts PGP private key block", () => {
    const input = "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQIVBGXXXXXXX\n-----END PGP PRIVATE KEY BLOCK-----";
    assert.equal(redactSensitive(input), "-----BEGIN REDACTED PRIVATE KEY-----");
  });
});

// ── parseLine ────────────────────────────────────────────

describe("parseLine", () => {
  it("parses valid JSON lines", () => {
    const result = parseLine('{"type":"user","message":{"content":"hi"}}');
    assert.deepEqual(result, { type: "user", message: { content: "hi" } });
  });

  it("returns null for invalid JSON", () => {
    assert.equal(parseLine("not json"), null);
    assert.equal(parseLine(""), null);
    assert.equal(parseLine("{broken"), null);
  });

  it("returns null for skipped types", () => {
    assert.equal(parseLine('{"type":"queue-operation"}'), null);
    assert.equal(parseLine('{"type":"file-history-snapshot"}'), null);
    assert.equal(parseLine('{"type":"change"}'), null);
    assert.equal(parseLine('{"type":"last-prompt"}'), null);
  });

  it("returns object for non-skipped types", () => {
    const result = parseLine('{"type":"user","data":"test"}');
    assert.deepEqual(result, { type: "user", data: "test" });
  });
});

// ── extractDisplayMessage ────────────────────────────────

describe("extractDisplayMessage", () => {
  const noRedact = (t) => t; // identity for easier assertions

  it("extracts summary messages", () => {
    const raw = { type: "summary", uuid: "abc", timestamp: "2026-01-01T00:00:00Z", message: { summary: "Test summary" } };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "system");
    assert.equal(result.display.type, "summary");
    assert.equal(result.display.text, "Test summary");
  });

  it("extracts simple user text messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "Hello" } };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "user");
    assert.equal(result.display.type, "text");
    assert.equal(result.display.text, "Hello");
  });

  it("filters out local-command-caveat messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<local-command-caveat>stuff</local-command-caveat>" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("parses command-name messages as structured command display", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<command-name>help</command-name>" } };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "user");
    assert.deepEqual(result.display, { type: "command", name: "help", args: "" });
  });

  it("filters out /clear command-name messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<command-name>/clear</command-name>" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("filters out local-command-clear messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<local-command-clear>stuff</local-command-clear>" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("extracts user messages with tool_result blocks only → role tool_response", () => {
    const raw = {
      type: "user", uuid: "u2", timestamp: "t2",
      message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "result text" }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "tool_response");
    assert.equal(result.display.parts[0].type, "tool_result");
    assert.equal(result.display.parts[0].text, "result text");
  });

  it("extracts user messages with mixed text+tool_result → role user", () => {
    const raw = {
      type: "user", uuid: "u3", timestamp: "t3",
      message: { content: [
        { type: "text", text: "Here is the result" },
        { type: "tool_result", tool_use_id: "tu2", content: "output" },
      ] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "user");
    assert.equal(result.display.parts.length, 2);
  });

  it("extracts assistant messages with text blocks", () => {
    const raw = {
      type: "assistant", uuid: "a1", timestamp: "t4",
      message: { model: "claude-4", content: [{ type: "text", text: "Hello!" }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "assistant");
    assert.equal(result.display.parts[0].text, "Hello!");
    assert.equal(result.display.model, "claude-4");
  });

  it("extracts assistant messages with thinking blocks", () => {
    const raw = {
      type: "assistant", uuid: "a2", timestamp: "t5",
      message: { model: "claude-4", content: [{ type: "thinking", thinking: "hmm..." }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.parts[0].type, "thinking");
    assert.equal(result.display.parts[0].text, "hmm...");
  });

  it("extracts assistant messages with tool_use blocks", () => {
    const raw = {
      type: "assistant", uuid: "a3", timestamp: "t6",
      message: { model: "claude-4", content: [{ type: "tool_use", name: "Read", id: "tu3", input: { path: "/foo" } }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.parts[0].type, "tool_use");
    assert.equal(result.display.parts[0].toolName, "Read");
    assert.equal(result.display.parts[0].toolCallId, "tu3");
  });

  it("returns null for empty assistant content", () => {
    const raw = { type: "assistant", uuid: "a4", timestamp: "t7", message: { content: [] } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("returns null for assistant with non-array content", () => {
    const raw = { type: "assistant", uuid: "a5", timestamp: "t8", message: { content: "just a string" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("returns null for unknown types", () => {
    const raw = { type: "unknown", uuid: "x", timestamp: "t" };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("passes isSidechain and cwd through", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "hi" }, isSidechain: true, cwd: "/home/project" };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.isSidechain, true);
    assert.equal(result.cwd, "/home/project");
  });

  it("applies redaction to extracted text", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "my key is sk-proj-aaaaaaaaaaaaaaaaaaaaaaaaaa" } };
    const result = extractDisplayMessage(raw); // uses default redactSensitive
    assert.ok(!result.display.text.includes("sk-proj-aaa"));
    assert.ok(result.display.text.includes("sk-***REDACTED***"));
  });

  it("handles tool_result with array content", () => {
    const raw = {
      type: "user", uuid: "u4", timestamp: "t9",
      message: { content: [{ type: "tool_result", tool_use_id: "tu4", content: [
        { type: "text", text: "file contents" },
        { type: "tool_reference", tool_name: "Read" },
      ] }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.parts[0].text, "file contents\n[Read]");
  });

  it("handles tool_result with non-string non-array content", () => {
    const raw = {
      type: "user", uuid: "u5", timestamp: "t10",
      message: { content: [{ type: "tool_result", tool_use_id: "tu5", content: 42 }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.parts[0].text, "42");
  });
});

// ── loadCustomPatterns ───────────────────────────────────

describe("loadCustomPatterns", () => {
  it("returns empty array when no CC_LIVE_REDACT env vars", () => {
    assert.deepEqual(loadCustomPatterns({}), []);
  });

  it("loads plain string patterns", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "my-secret-word" });
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].replacement, "***REDACTED***");
    assert.equal("my-secret-word is here".replace(patterns[0].pattern, patterns[0].replacement), "***REDACTED*** is here");
  });

  it("loads regex patterns with custom replacement", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "/foo\\d+/→[HIDDEN]" });
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].replacement, "[HIDDEN]");
    assert.equal("foo123 bar".replace(patterns[0].pattern, patterns[0].replacement), "[HIDDEN] bar");
  });

  it("loads multiple patterns", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "secret1", CC_LIVE_REDACT_2: "secret2" });
    assert.equal(patterns.length, 2);
  });
});

// ── validateShareTokenEntries ─────────────────────────────

describe("validateShareTokenEntries", () => {
  it("accepts valid entries", () => {
    const result = validateShareTokenEntries({
      abc123: { project: "/Users/nick/foo", createdAt: 1712500000000 },
      def456: { project: "/Users/nick/bar", createdAt: 1712600000000 },
    });
    assert.equal(result.size, 2);
    assert.equal(result.get("abc123").project, "/Users/nick/foo");
    assert.equal(result.get("def456").createdAt, 1712600000000);
  });

  it("rejects entries with missing project", () => {
    const result = validateShareTokenEntries({
      abc: { createdAt: 1712500000000 },
    });
    assert.equal(result.size, 0);
  });

  it("rejects entries with non-string project", () => {
    const result = validateShareTokenEntries({
      abc: { project: 123, createdAt: 1712500000000 },
    });
    assert.equal(result.size, 0);
  });

  it("rejects entries with missing createdAt", () => {
    const result = validateShareTokenEntries({
      abc: { project: "/foo" },
    });
    assert.equal(result.size, 0);
  });

  it("rejects entries with non-number createdAt", () => {
    const result = validateShareTokenEntries({
      abc: { project: "/foo", createdAt: "2026-04-08" },
    });
    assert.equal(result.size, 0);
  });

  it("rejects null info", () => {
    const result = validateShareTokenEntries({ abc: null });
    assert.equal(result.size, 0);
  });

  it("rejects undefined info", () => {
    const result = validateShareTokenEntries({ abc: undefined });
    assert.equal(result.size, 0);
  });

  it("handles mixed valid and invalid entries", () => {
    const result = validateShareTokenEntries({
      good1: { project: "/foo", createdAt: 1000 },
      bad1: { project: "/foo" },
      bad2: null,
      good2: { project: "/bar", createdAt: 2000 },
    });
    assert.equal(result.size, 2);
    assert.ok(result.has("good1"));
    assert.ok(result.has("good2"));
    assert.ok(!result.has("bad1"));
    assert.ok(!result.has("bad2"));
  });

  it("returns empty Map for empty object", () => {
    const result = validateShareTokenEntries({});
    assert.equal(result.size, 0);
    assert.ok(result instanceof Map);
  });
});

// ── esc ──────────────────────────────────────────────────

describe("esc", () => {
  it("returns empty string for falsy input", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
    assert.equal(esc(""), "");
    assert.equal(esc(0), "");
    assert.equal(esc(false), "");
  });

  it("converts non-string input to string then escapes", () => {
    assert.equal(esc(42), "42");
    assert.equal(esc(true), "true");
  });

  it("escapes &", () => {
    assert.equal(esc("a&b"), "a&amp;b");
  });

  it("escapes <", () => {
    assert.equal(esc("a<b"), "a&lt;b");
  });

  it("escapes >", () => {
    assert.equal(esc("a>b"), "a&gt;b");
  });

  it("escapes double quotes", () => {
    assert.equal(esc('a"b'), "a&quot;b");
  });

  it("escapes all special chars in one string", () => {
    assert.equal(esc('<div class="x">&</div>'), "&lt;div class=&quot;x&quot;&gt;&amp;&lt;/div&gt;");
  });

  it("returns clean text unchanged", () => {
    assert.equal(esc("hello world 123"), "hello world 123");
  });
});

// ── isDiffContent ────────────────────────────────────────

describe("isDiffContent", () => {
  it("returns true for lang=diff", () => {
    assert.equal(isDiffContent("diff", "anything"), true);
  });

  it("returns false for other explicit languages", () => {
    assert.equal(isDiffContent("javascript", "var x = 1"), false);
    assert.equal(isDiffContent("python", "print('hi')"), false);
    assert.equal(isDiffContent("bash", "echo hi"), false);
  });

  it("detects diff with @@ hunk headers and changes", () => {
    const text = "@@ -1,3 +1,3 @@\n-old line\n+new line\n context";
    assert.equal(isDiffContent(undefined, text), true);
  });

  it("detects diff with hunk header but only adds", () => {
    const text = "@@ -1 +1,2 @@\n+added line";
    assert.equal(isDiffContent(undefined, text), true);
  });

  it("does not detect diff with hunk but no changes", () => {
    const text = "@@ -1,3 +1,3 @@\n context\n more context";
    assert.equal(isDiffContent(undefined, text), false);
  });

  it("detects diff without hunk headers when add+del > 30%", () => {
    const lines = ["-removed", "+added", "-removed2"];
    assert.equal(isDiffContent(undefined, lines.join("\n")), true);
  });

  it("does not detect diff when only additions (no deletions)", () => {
    const text = "+added line\n+another added\ncontext line";
    assert.equal(isDiffContent(undefined, text), false);
  });

  it("does not detect diff when only deletions (no additions)", () => {
    const text = "-removed line\n-another removed\ncontext line";
    assert.equal(isDiffContent(undefined, text), false);
  });

  it("ignores +++ and --- lines as add/del", () => {
    const text = "--- a/file.txt\n+++ b/file.txt\ncontext";
    assert.equal(isDiffContent(undefined, text), false);
  });

  it("treats lang=plaintext same as no lang", () => {
    const text = "@@ -1 +1 @@\n-old\n+new";
    assert.equal(isDiffContent("plaintext", text), true);
  });

  it("returns false for normal text", () => {
    assert.equal(isDiffContent(undefined, "hello world\nfoo bar"), false);
  });
});

// ── renderDiff ───────────────────────────────────────────

describe("renderDiff", () => {
  it("wraps output in pre.diff-block", () => {
    const result = renderDiff("hello");
    assert.ok(result.startsWith('<pre class="diff-block"><code class="hljs language-diff">'));
    assert.ok(result.endsWith("</code></pre>"));
  });

  it("renders @@ lines as diff-hunk", () => {
    const result = renderDiff("@@ -1,3 +1,3 @@");
    assert.ok(result.includes("diff-hunk"));
    assert.ok(result.includes("@@ -1,3 +1,3 @@"));
  });

  it("renders + lines as diff-add", () => {
    const result = renderDiff("+added line");
    assert.ok(result.includes("diff-add"));
    assert.ok(result.includes("+added line"));
  });

  it("renders - lines as diff-del", () => {
    const result = renderDiff("-removed line");
    assert.ok(result.includes("diff-del"));
    assert.ok(result.includes("-removed line"));
  });

  it("renders context lines without add/del/hunk class", () => {
    const result = renderDiff("just a context line");
    assert.ok(result.includes("diff-line"));
    assert.ok(!result.includes("diff-add"));
    assert.ok(!result.includes("diff-del"));
    assert.ok(!result.includes("diff-hunk"));
  });

  it("escapes HTML in diff content", () => {
    const result = renderDiff('+<script>alert("xss")</script>');
    assert.ok(!result.includes("<script>"));
    assert.ok(result.includes("&lt;script&gt;"));
  });

  it("renders multi-line diff with correct classes", () => {
    const result = renderDiff("@@ -1 +1 @@\n-old\n+new\n ctx");
    assert.ok(result.includes("diff-hunk"));
    assert.ok(result.includes("diff-del"));
    assert.ok(result.includes("diff-add"));
    // context line gets diff-line but not diff-add/del/hunk
  });
});

// ── detectContentType ────────────────────────────────────

describe("detectContentType", () => {
  it("detects fenced code blocks as code", () => {
    assert.equal(detectContentType("```js\nconsole.log('hi')\n```"), "code");
    assert.equal(detectContentType("```\nbare code\n```"), "code");
  });

  it("detects valid JSON object as json", () => {
    assert.equal(detectContentType('{"key": "value"}'), "json");
  });

  it("detects valid JSON array as json", () => {
    assert.equal(detectContentType('[1, 2, 3]'), "json");
  });

  it("does not detect invalid JSON as json", () => {
    assert.equal(detectContentType("{not valid json}"), "text");
  });

  it("detects mostly-indented content as code", () => {
    const text = "line1\n  indented1\n  indented2\n  indented3\n  indented4";
    assert.equal(detectContentType(text), "code");
  });

  it("returns text for normal prose", () => {
    assert.equal(detectContentType("hello world\nthis is text"), "text");
  });

  it("returns text for short content", () => {
    assert.equal(detectContentType("hi"), "text");
  });

  it("handles whitespace-only input", () => {
    assert.equal(detectContentType("   \n  \n  "), "text");
  });

  it("does not detect code with low indentation ratio", () => {
    const text = "line1\n  indented\nline3\nline4\nline5";
    assert.equal(detectContentType(text), "text");
  });

  it("requires >3 lines for indentation-based code detection", () => {
    const text = "  a\n  b\n  c";
    assert.equal(detectContentType(text), "text");
  });
});
