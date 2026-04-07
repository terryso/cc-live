import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  redactSensitive, parseLine, extractDisplayMessage,
  BASE_SENSITIVE_PATTERNS, loadCustomPatterns,
} from "./lib.js";

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

  it("filters out command-name messages", () => {
    const raw = { type: "user", uuid: "u1", timestamp: "t1", message: { content: "<command-name>help</command-name>" } };
    assert.equal(extractDisplayMessage(raw, noRedact), null);
  });

  it("filters out local-command messages", () => {
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
