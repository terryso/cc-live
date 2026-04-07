# Deferred Work

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) writes. Add 150ms debounce timer for scale. Not urgent at current project scale.

## Deferred from: code review of spec-viewer-count (2026-04-08)

- [ ] Debounce `broadcastViewerCount()` — rapid connect/disconnect causes O(N^2) broadcast writes. Not urgent at current scale.
- [ ] `res.write()` on destroyed socket can crash process — `sseSend` and `broadcastViewerCount` have no error handling for write failures on dead sockets. Pre-existing issue, exacerbated by new broadcast call site.
