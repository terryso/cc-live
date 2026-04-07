# CC Live

<div>

[![GitHub License](https://img.shields.io/github/license/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/blob/main/LICENSE)
[![Node Version](https://img.shields.io/node/v-literally/22?style=flat-square&color=brightgreen&label=node%20%3E%3D)](https://nodejs.org/)
[![GitHub Repo stars](https://img.shields.io/github/stars/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live)
[![GitHub Issues](https://img.shields.io/github/issues/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/issues)
[![BMAD](https://bmad-badge.vercel.app/terryso/cc-live.svg)](https://github.com/bmad-code-org/BMAD-METHOD)

</div>

[中文文档](README_CN.md)

Real-time viewer for Claude Code sessions. Watch your AI coding process live, share with anyone via a URL.

**Zero dependencies** — single file Node.js server, no install needed.

> **⚠️ WARNING: No sensitive data filtering yet!** Conversation content is shared as-is — API keys, passwords, tokens, and other secrets will be visible to anyone with the share link. **Review your session content before sharing.** Sensitive information filtering will be added in a future release.

## Features

- Auto-discovers all Claude Code projects from `~/.claude/projects/`
- Live streaming via SSE — messages appear as they happen
- Project-based view with pagination and scroll navigation
- Share individual projects via token-protected URLs
- Displays user messages, assistant responses, thinking, tool calls and results
- Dark theme, monospace, mobile-friendly

## Quick Start

```bash
# Start the server
node server.js

# Open in browser
open http://localhost:3456
```

That's it — all your Claude Code sessions appear in the sidebar, grouped by project.

## Sharing

### Option 1: ngrok

```bash
# Install ngrok if you haven't
# brew install ngrok

# Create a public URL
ngrok http 3456
```

Set the public URL in `.env` so share links use the correct domain:

```
CC_LIVE_PUBLIC_URL=https://your-subdomain.ngrok-free.dev
```

### Option 2: Cloudflare Tunnel

```bash
# Install cloudflared if you haven't
# brew install cloudflared

# Create a public URL
cloudflared tunnel --url http://localhost:3456
```

Set the public URL in `.env`:

```
CC_LIVE_PUBLIC_URL=https://your-subdomain.trycloudflare.com
```

### Creating a share link

1. Click the **Share** button next to any project in the sidebar
2. Copy the generated URL — it contains a random token, no project name exposed
3. Revoke anytime from the **Active Shares** panel at the bottom of the sidebar

Share tokens are stored in memory only — restarting the server invalidates all tokens.

## Configuration

Environment variables (set in `.env` or shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_LIVE_PORT` | `3456` | Server port |
| `CLAUDE_DIR` | `~/.claude` | Claude config directory |
| `CC_LIVE_PUBLIC_URL` | — | Public tunnel URL for share links |

## How It Works

1. Scans `~/.claude/projects/` for JSONL session files (up to 50 projects, 7-day recency)
2. Loads last 200 messages per session as history, then tails for new content
3. Parses messages and streams via SSE to connected browsers
4. Every 10s rescans for new sessions

## Limitations

- Read-only — viewers cannot interact with the session
- Session data is in-memory only (up to 500 messages per session, then trimmed to 300)
- Share tokens are lost on server restart

## License

MIT
