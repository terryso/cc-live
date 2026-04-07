---
title: 'Share View Chat with Tlk.io'
type: 'feature'
created: '2026-04-08'
status: 'done'
baseline_commit: '0d778eb'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** When a session is shared via link, viewers can only passively watch. The sidebar shows a single project (redundant with header) and the header incorrectly displays "Select a project" instead of the shared project name.

**Approach:** Embed Tlk.io in the sidebar during share view, using the share token as the room name for automatic per-project isolation. Fix the header to show the correct project name.

## Boundaries & Constraints

**Always:** Use Tlk.io iframe embed. Room name = share token (provides per-project isolation). Sidebar shows chat only in share view. Admin/local view unchanged.

**Ask First:** None.

**Never:** No custom IM backend. No persistence of chat messages on our side. No changes to non-share view.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Viewer opens shared link | `?t=valid_token` | Sidebar shows Tlk.io chat; header shows project name | N/A |
| Admin opens local view | No share token | Sidebar shows project list as before | N/A |
| Tlk.io iframe loads | Share token as room | Chat room scoped to that token | N/A |

</frozen-after-approval>

## Code Map

- `public/index.html` -- Single-page frontend with sidebar + main content, share-info SSE handler
- `server.js` -- SSE server, share token auth (for reference on token format)

## Tasks & Acceptance

**Execution:**
- [x] `public/index.html` -- Fix `share-info` handler to set `#title` textContent to project name -- Bug fix
- [x] `public/index.html` -- In share view, replace sidebar content (project list + shares panel) with a Tlk.io iframe using share token as room name; adjust sidebar layout for full-height chat -- Chat integration

**Acceptance Criteria:**
- Given a shared link is opened, when the page loads, then the sidebar shows a Tlk.io chat room and the header shows the project name
- Given admin view (no share token), when the page loads, then the sidebar shows project list unchanged

## Spec Change Log

## Verification

**Manual checks:**
- Open share link, verify Tlk.io chat loads in sidebar with correct room
- Verify header shows project name instead of "Select a project"
- Open local admin view, verify sidebar unchanged (project list)

## Suggested Review Order

- Header bug fix — sets project name instead of "Select a project"
  [`index.html:182`](../../public/index.html#L182)

- Chat activation logic — token extraction, iframe guard, DOM API with encodeURIComponent
  [`index.html:184`](../../public/index.html#L184)

- iframe creation with sandbox and security attributes
  [`index.html:190`](../../public/index.html#L190)

- Chat container CSS — hidden by default, flex layout with min-height guard
  [`index.html:80`](../../public/index.html#L80)

- Chat container HTML element inserted between slist and shares-panel
  [`index.html:94`](../../public/index.html#L94)
