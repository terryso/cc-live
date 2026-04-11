# Deferred Work

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) writes. Add 150ms debounce timer for scale. Not urgent at current project scale.

## Deferred from: code review of spec-viewer-count (2026-04-08)

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) broadcast writes. Not urgent at current scale.
- [ ] `res.write()` on destroyed socket can crash process — `sseSend` and `broadcastViewerCount` have no error handling for write failures on dead sockets. Pre-existing issue, exacerbated by new broadcast call site.

## Deferred from: code review of spec-persistent-share-tokens (2026-04-08)

- [ ] Atomic write for share-tokens.json — use write-to-temp-then-rename (`writeFile` to `.tmp` then `rename`) to prevent data loss on crash mid-write. Low risk for a local dev tool.
- [ ] Redundant `mkdir` on every `saveShareTokens()` — could be called once at startup instead of every save. Minor performance concern.
- [ ] `loadShareTokens` appends to Map without clearing — only called once at startup so latent, but would cause duplicates if ever called again.

## Deferred from: adversarial review of html-hot-reload (2026-04-08)

- [ ] Session history API `/api/session/:id` missing auth check for remote callers without share token — `!local && !share` requests fall through instead of returning 403. Pre-existing.
- [ ] SSE `/events` connection leak when access denied — response opened as text/event-stream but never ended for unauthorized remote requests. Pre-existing.
- [ ] No request body size limit on `readBody` helper — unbounded memory consumption possible. Pre-existing.
- [ ] Wildcard CORS (`Access-Control-Allow-Origin: *`) on sensitive session data server — defense-in-depth gap. Pre-existing.
- [ ] `limit` query param NaN edge case produces empty response instead of error. Pre-existing.
- [ ] Share tokens never expire — `createdAt` exists but no cleanup logic. Pre-existing.

## Deferred from: review of spec-epic1-thinking-rendering (2026-04-09)

- [ ] Truncation at 500 chars may break markdown constructs spanning the boundary (unclosed bold/code fence) — DOMPurify prevents XSS; visual artifact is minor for preview. Could truncate rendered HTML instead of raw text for cleaner output.
- [ ] Double render (full + truncated) for long thinking — could lazy-render full content on expand. Current approach trades perf for simplicity.
- [ ] Expanded thinking content remains italic — consider `.msg-thinking.thinking-expanded { font-style: normal }` for readability of long-form content.

## Deferred from: review of spec-epic2-tool-visualization (2026-04-09)

- [ ] fmtTodo no length cap on todos array — very large todo lists could bloat DOM. Add `todos.slice(0, 50)` with overflow indicator if needed.
- [ ] fmtEdit old_string/new_string very long (10k+ chars) — unbounded DOM. Add truncation with "..." indicator if needed.

## Deferred from: review of spec-epic3-tool-result-rendering (2026-04-09)

- [ ] hljs.highlightAuto / JSON.stringify on very large tool results (>100KB) — could freeze UI. Add size guard and truncate.
- [ ] renderCodeResult hljs auto-detection on very large strings — add max-length guard before highlighting.

## Deferred from: fix-tool-response-rendering (2026-04-09)

- [ ] `var(--fg)` CSS variable used but never defined — lines 446 and 474 in index.html use `var(--fg)` which doesn't exist in `:root` or `[data-theme="dark"]`. Should be `var(--text)` or similar. Pre-existing.

## Deferred from: review of spec-epic4-danmaku-system (2026-04-10)

- [ ] Unbounded danmaku file growth — no max entry count or TTL cleanup per session. Add cap (e.g., last 500 entries) in saveDanmaku, or periodic cleanup of old files.
- [ ] Read-modify-write race on danmaku files — concurrent POST requests could lose entries. Use per-session mutex or append-only JSONL format. Low priority for current traffic levels.
- [ ] SSE reconnect danmaku deduplication — after reconnect, history reload may replay danmaku already displayed. Add client-side event ID dedup set.
- [ ] Mobile danmaku responsiveness — danmaku layer and input bar lack mobile-specific adjustments (smaller font, narrower touch targets).

## Deferred from: review of spec-share-link-password (2026-04-11)

- [ ] COOKIE_SECRET regenerated on server restart — invalidates all auth cookies, forcing users to re-enter passwords. Could persist secret to data/ file for stability.
- [ ] No rate limiting on POST /api/shares/:token/auth — online brute-force feasible with 6-char password. Add per-IP rate limiting for production use.
