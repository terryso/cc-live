import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  redactSensitive, parseLine, extractDisplayMessage,
  validateShareTokenEntries,
  BASE_SENSITIVE_PATTERNS, loadCustomPatterns,
  detectKillFeedEvent, KILL_FEED_TYPES,
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

  it("redacts secret= assignments", () => {
    const result = redactSensitive("secret=mySecretValue123!");
    assert.ok(result.includes("secret=***REDACTED***"));
    assert.ok(!result.includes("mySecretValue123"));
  });

  it("redacts access_key assignments", () => {
    const result = redactSensitive("access_key=myAccessKeyValue12345");
    assert.ok(result.includes("access_key=***REDACTED***"));
    assert.ok(!result.includes("myAccessKeyValue12345"));
  });

  it("redacts private_key assignments", () => {
    const result = redactSensitive("private_key=myPrivateKeyData12345");
    assert.ok(result.includes("private_key=***REDACTED***"));
    assert.ok(!result.includes("myPrivateKeyData12345"));
  });

  it("redacts auth_token assignments", () => {
    const result = redactSensitive("auth_token=myAuthTokenValue1234");
    assert.ok(result.includes("auth_token=***REDACTED***"));
    assert.ok(!result.includes("myAuthTokenValue1234"));
  });

  it("redacts TOKEN= assignments", () => {
    const result = redactSensitive("TOKEN=abcdefghijklmnop12345678");
    assert.ok(result.includes("TOKEN=***REDACTED***"));
    assert.ok(!result.includes("abcdefghijklmnop"));
  });

  it("redacts token= assignments", () => {
    const result = redactSensitive("token=abcdefghijklmnop12345678");
    assert.ok(result.includes("token=***REDACTED***"));
    assert.ok(!result.includes("abcdefghijklmnop"));
  });

  it("redacts AWS Secret Access Key", () => {
    const result = redactSensitive("AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    assert.ok(result.includes("***REDACTED***"));
    assert.ok(!result.includes("wJalrXUtnFEMI"));
  });

  it("redacts AWS SecretAccessKey with colon", () => {
    const result = redactSensitive("AWSSecretAccessKey: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
    assert.ok(result.includes("***REDACTED***"));
    assert.ok(!result.includes("wJalrXUtnFEMI"));
  });

  it("redacts mysql2:// connection string", () => {
    const result = redactSensitive("mysql2://root:password123@localhost:3306/mydb");
    assert.ok(!result.includes("password123"));
    assert.ok(result.includes("@localhost"));
  });

  it("redacts redis:// with password containing special chars", () => {
    const result = redactSensitive("redis://:p@ss_w0rd@redis.example.com:6379");
    assert.ok(!result.includes("p@ss_w0rd"));
    assert.ok(result.includes("@redis.example.com"));
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

  // ── Additional coverage for processUserText paths ──

  it("shows non-empty local-command-stdout content", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<local-command-stdout>build output here</local-command-stdout>" } };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "user");
    assert.equal(result.display.text, "build output here");
  });

  it("filters out empty local-command-stdout content", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<local-command-stdout>   </local-command-stdout>" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("filters out 'Base directory for this skill:' messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "Base directory for this skill: /path/to/skill" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("parses command-name with command-args", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<command-name>help</command-name><command-args>me please</command-args>" } };
    const result = extractDisplayMessage(raw, noRedact);
    assert.deepEqual(result.display, { type: "command", name: "help", args: "me please" });
  });

  it("returns null for user with non-string non-array content", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: 42 } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("returns null for user with null content", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: null } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("returns null for user with undefined content", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: {} };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("returns null when all array blocks are filtered", () => {
    const raw = {
      type: "user", uuid: "u1", timestamp: "t1",
      message: { content: [
        { type: "text", text: "<local-command-caveat>skip me</local-command-caveat>" },
      ] },
    };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("handles structured command result from array text block", () => {
    const raw = {
      type: "user", uuid: "u1", timestamp: "t1",
      message: { content: [
        { type: "text", text: "<command-name>commit</command-name><command-args>-m fix</command-args>" },
      ] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.role, "user");
    assert.equal(result.display.parts[0].type, "command");
    assert.equal(result.display.parts[0].name, "commit");
    assert.equal(result.display.parts[0].args, "-m fix");
  });

  it("extracts summary with empty message.summary", () => {
    const raw = { type: "summary", uuid: "abc", timestamp: "t1", message: {} };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.text, "");
  });

  it("extracts summary with no message object", () => {
    const raw = { type: "summary", uuid: "abc", timestamp: "t1" };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.text, "");
  });

  it("assistant with no model defaults to empty string", () => {
    const raw = {
      type: "assistant", uuid: "a1", timestamp: "t1",
      message: { content: [{ type: "text", text: "hi" }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.model, "");
  });

  it("assistant skips unknown block types", () => {
    const raw = {
      type: "assistant", uuid: "a1", timestamp: "t1",
      message: { content: [{ type: "unknown_block", data: "x" }, { type: "text", text: "actual text" }] },
    };
    const result = extractDisplayMessage(raw, noRedact);
    assert.equal(result.display.parts.length, 1);
    assert.equal(result.display.parts[0].text, "actual text");
  });

  it("assistant with only unknown blocks returns null", () => {
    const raw = {
      type: "assistant", uuid: "a1", timestamp: "t1",
      message: { content: [{ type: "custom_block" }] },
    };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
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

  it("loads regex pattern that matches literally", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "/FOO/→[MASKED]" });
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].replacement, "[MASKED]");
    assert.equal("FOO bar".replace(patterns[0].pattern, patterns[0].replacement), "[MASKED] bar");
  });

  it("silently skips invalid regex patterns", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "/[invalid/→redacted" });
    assert.equal(patterns.length, 0);
  });

  it("stops loading at first missing index", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "alpha", CC_LIVE_REDACT_3: "gamma" });
    assert.equal(patterns.length, 1);
  });

  it("escapes special regex chars in plain string patterns", () => {
    const patterns = loadCustomPatterns({ CC_LIVE_REDACT_1: "file.txt" });
    assert.equal(patterns.length, 1);
    // The dot should be escaped, so "file_txt" won't match
    assert.equal("file_txt".replace(patterns[0].pattern, patterns[0].replacement), "file_txt");
    // But "file.txt" should match
    assert.equal("file.txt".replace(patterns[0].pattern, patterns[0].replacement), "***REDACTED***");
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

// ── Danmaku: project name validation ──────────────────────────

describe("danmaku project name validation", () => {
  const validPattern = /^[\w-]+$/;

  it("accepts alphanumeric project names", () => {
    assert.ok(validPattern.test("abc123"));
    assert.ok(validPattern.test("session-2026-04-10"));
    assert.ok(validPattern.test("a1b2c3d4e5f6"));
  });

  it("accepts underscores and hyphens", () => {
    assert.ok(validPattern.test("my_session-id_123"));
  });

  it("rejects path traversal attempts", () => {
    assert.ok(!validPattern.test("../../etc/passwd"));
    assert.ok(!validPattern.test("../../../share-tokens"));
    assert.ok(!validPattern.test("..\\windows\\system32"));
  });

  it("rejects slashes", () => {
    assert.ok(!validPattern.test("foo/bar"));
    assert.ok(!validPattern.test("/absolute/path"));
  });

  it("rejects dots", () => {
    assert.ok(!validPattern.test("file.json"));
    assert.ok(!validPattern.test(".hidden"));
  });

  it("rejects empty string", () => {
    assert.ok(!validPattern.test(""));
  });

  it("rejects spaces", () => {
    assert.ok(!validPattern.test("session id"));
  });

  it("rejects special characters", () => {
    assert.ok(!validPattern.test("id<script>"));
    assert.ok(!validPattern.test("id'OR'1'='1"));
    assert.ok(!validPattern.test("id;rm -rf"));
  });
});

// ── Danmaku: file persistence ──────────────────────────────

describe("danmaku file persistence", () => {
  const testDir = join(tmpdir(), "cc-live-danmaku-test-" + Date.now());

  async function loadDanmaku(project) {
    try {
      const content = await readFile(join(testDir, `${project}.json`), "utf8");
      return JSON.parse(content);
    } catch { return []; }
  }

  async function saveDanmaku(project, data) {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, `${project}.json`), JSON.stringify(data), "utf8");
  }

  it("returns empty array for non-existent project", async () => {
    const result = await loadDanmaku("nonexistent");
    assert.deepEqual(result, []);
  });

  it("saves and loads danmaku entries", async () => {
    const entries = [
      { id: "abc123", nickname: "快乐水豚", content: "hello", timestamp: "2026-04-10T00:00:00Z" },
    ];
    await saveDanmaku("sess1", entries);
    const loaded = await loadDanmaku("sess1");
    assert.deepEqual(loaded, entries);
  });

  it("appends entries correctly", async () => {
    const entries = [{ id: "1", nickname: "A", content: "first", timestamp: "t1" }];
    await saveDanmaku("proj2", entries);
    const existing = await loadDanmaku("proj2");
    existing.push({ id: "2", nickname: "B", content: "second", timestamp: "t2" });
    await saveDanmaku("proj2", existing);
    const loaded = await loadDanmaku("proj2");
    assert.equal(loaded.length, 2);
    assert.equal(loaded[0].content, "first");
    assert.equal(loaded[1].content, "second");
  });

  it("handles multiple projects independently", async () => {
    await saveDanmaku("proj-a", [{ id: "a1", content: "A" }]);
    await saveDanmaku("proj-b", [{ id: "b1", content: "B" }]);
    assert.equal((await loadDanmaku("proj-a")).length, 1);
    assert.equal((await loadDanmaku("proj-b")).length, 1);
    assert.equal((await loadDanmaku("proj-a"))[0].content, "A");
    assert.equal((await loadDanmaku("proj-b"))[0].content, "B");
  });

  it("returns empty array for corrupted JSON file", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "corrupt.json"), "not valid json{{{", "utf8");
    const result = await loadDanmaku("corrupt");
    assert.deepEqual(result, []);
  });

  // Cleanup
  it("cleans up test directory", async () => {
    await rm(testDir, { recursive: true, force: true });
    assert.ok(true);
  });
});

// ── Kill Feed Event Detection ─────────────────────────────

describe("detectKillFeedEvent", () => {
  const noRedact = (t) => t;

  function makeMsg(role, parts) {
    return { role, display: { type: "blocks", parts }, uuid: "test", timestamp: new Date().toISOString() };
  }

  it("returns null for null/undefined messages", () => {
    assert.equal(detectKillFeedEvent(null), null);
    assert.equal(detectKillFeedEvent(undefined), null);
  });

  it("returns null for messages without display", () => {
    assert.equal(detectKillFeedEvent({ role: "assistant" }), null);
  });

  it("detects Code Surge from Write tool (≥50 lines)", () => {
    const content = Array(55).fill("line of code").join("\n");
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Write", toolCallId: "1", args: JSON.stringify({ file_path: "/test.js", content }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    const ev = detectKillFeedEvent(msg, ctx);
    assert.equal(ev.type, KILL_FEED_TYPES.CODE_SURGE);
    assert.equal(ev.icon, "📝");
    assert.ok(ev.text.includes("55"));
  });

  it("does not trigger Code Surge for small writes (<50 lines)", () => {
    const content = Array(10).fill("line").join("\n");
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Write", toolCallId: "1", args: JSON.stringify({ file_path: "/test.js", content }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    assert.equal(detectKillFeedEvent(msg, ctx), null);
  });

  it("detects Code Surge from Edit tool (≥20 lines changed)", () => {
    const old = Array(12).fill("old line").join("\n");
    const nw = Array(12).fill("new line").join("\n");
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Edit", toolCallId: "2", args: JSON.stringify({ file_path: "/test.js", old_string: old, new_string: nw }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    const ev = detectKillFeedEvent(msg, ctx);
    assert.equal(ev.type, KILL_FEED_TYPES.CODE_SURGE);
    assert.equal(ev.icon, "✏️");
  });

  it("detects Bug Fix from Bash command with fix keyword", () => {
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Bash", toolCallId: "3", args: JSON.stringify({ command: "npm run fix-bug-123" }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    const ev = detectKillFeedEvent(msg, ctx);
    assert.equal(ev.type, KILL_FEED_TYPES.BUG_FIX);
    assert.equal(ev.icon, "🔥");
  });

  it("detects Bug Fix from Bash command with 'resolve' keyword", () => {
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Bash", toolCallId: "3b", args: JSON.stringify({ command: "node resolve-issue.js" }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    const ev = detectKillFeedEvent(msg, ctx);
    assert.equal(ev.type, KILL_FEED_TYPES.BUG_FIX);
  });

  it("does not trigger Bug Fix for normal Bash commands", () => {
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Bash", toolCallId: "4", args: JSON.stringify({ command: "npm install" }) },
    ]);
    const ctx = { consecutiveReads: 0 };
    assert.equal(detectKillFeedEvent(msg, ctx), null);
  });

  it("detects Tests Pass from tool result", () => {
    const msg = makeMsg("tool_response", [
      { type: "tool_result", toolUseId: "5", text: "3 tests passed\nAll good!" },
    ]);
    const ctx = { consecutiveReads: 0 };
    const ev = detectKillFeedEvent(msg, ctx);
    assert.equal(ev.type, KILL_FEED_TYPES.TESTS_PASS);
    assert.equal(ev.icon, "✅");
  });

  it("detects Tests Pass with 'passing' keyword", () => {
    const msg = makeMsg("tool_response", [
      { type: "tool_result", toolUseId: "5b", text: "12 passing, 0 failing" },
    ]);
    const ev = detectKillFeedEvent(msg, { consecutiveReads: 0 });
    assert.equal(ev.type, KILL_FEED_TYPES.TESTS_PASS);
  });

  it("does not trigger Tests Pass for non-test output", () => {
    const msg = makeMsg("tool_response", [
      { type: "tool_result", toolUseId: "6", text: "Server started on port 3000" },
    ]);
    assert.equal(detectKillFeedEvent(msg, { consecutiveReads: 0 }), null);
  });

  it("detects Deep Dive after 5 consecutive reads", () => {
    const ctx = { consecutiveReads: 0 };
    for (let i = 0; i < 4; i++) {
      const msg = makeMsg("assistant", [
        { type: "tool_use", toolName: "Read", toolCallId: `r${i}`, args: JSON.stringify({ file_path: `/f${i}.js` }) },
      ]);
      const ev = detectKillFeedEvent(msg, ctx);
      assert.equal(ev, null, `Should not trigger on read ${i + 1}`);
    }
    // 5th read triggers
    const msg5 = makeMsg("assistant", [
      { type: "tool_use", toolName: "Grep", toolCallId: "r4", args: JSON.stringify({ pattern: "TODO" }) },
    ]);
    const ev5 = detectKillFeedEvent(msg5, ctx);
    assert.equal(ev5.type, KILL_FEED_TYPES.DEEP_DIVE);
    assert.equal(ev5.icon, "🔍");
  });

  it("resets consecutive reads on Write", () => {
    const ctx = { consecutiveReads: 4 };
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Write", toolCallId: "w1", args: JSON.stringify({ file_path: "/out.js", content: "x" }) },
    ]);
    detectKillFeedEvent(msg, ctx);
    assert.equal(ctx.consecutiveReads, 0);
  });

  it("resets consecutive reads on Bash", () => {
    const ctx = { consecutiveReads: 3 };
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Bash", toolCallId: "b1", args: JSON.stringify({ command: "echo hi" }) },
    ]);
    detectKillFeedEvent(msg, ctx);
    assert.equal(ctx.consecutiveReads, 0);
  });

  it("handles malformed tool args gracefully", () => {
    const msg = makeMsg("assistant", [
      { type: "tool_use", toolName: "Write", toolCallId: "x", args: "not-valid-json{{{" },
    ]);
    const ctx = { consecutiveReads: 0 };
    assert.equal(detectKillFeedEvent(msg, ctx), null);
  });

  it("ignores text-only assistant messages", () => {
    const msg = makeMsg("assistant", [
      { type: "text", text: "I'll fix that bug now." },
    ]);
    assert.equal(detectKillFeedEvent(msg, { consecutiveReads: 0 }), null);
  });

  it("ignores user messages", () => {
    const msg = makeMsg("user", [
      { type: "text", text: "please fix the login bug" },
    ]);
    assert.equal(detectKillFeedEvent(msg, { consecutiveReads: 0 }), null);
  });
});
