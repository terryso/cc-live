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
