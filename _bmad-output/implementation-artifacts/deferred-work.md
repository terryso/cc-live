# Deferred Work

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) writes. Add 150ms debounce timer for scale. Not urgent at current project scale.

## Deferred from: code review of spec-viewer-count (2026-04-08)

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) broadcast writes. Not urgent at current scale.
- [ ] `res.write()` on destroyed socket can crash process — `sseSend` and `broadcastViewerCount` have no error handling for write failures on dead sockets. Pre-existing issue, exacerbated by new broadcast call site.

## Deferred from: code review of spec-persistent-share-tokens (2026-04-08)

- [ ] Atomic write for share-tokens.json — use write-to-temp-then-rename (`writeFile` to `.tmp` then `rename`) to prevent data loss on crash mid-write. Low risk for a local dev tool.
- [ ] Redundant `mkdir` on every `saveShareTokens()` — could be called once at startup instead of every save. Minor performance concern.
- [ ] `loadShareTokens` appends to Map without clearing — only called once at startup so latent, but would cause duplicates if ever called again.
