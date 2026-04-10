# CC Live

<img src="public/banner.svg" width="100%" alt="CC Live Banner"/>

<div>

[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square)](https://nodejs.org/)
[![GitHub Repo stars](https://img.shields.io/github/stars/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live)
[![GitHub Issues](https://img.shields.io/github/issues/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/issues)
[![BMAD](https://bmad-badge.vercel.app/terryso/cc-live.svg)](https://github.com/bmad-code-org/BMAD-METHOD)
[![GitHub License](https://img.shields.io/github/license/terryso/cc-live?style=flat-square)](https://github.com/terryso/cc-live/blob/main/LICENSE)

</div>

[中文文档](README_CN.md)

Real-time viewer for Claude Code sessions. Watch your AI coding process live, share with anyone via a URL.

**Zero dependencies** — single file Node.js server, no install needed.

![CC Live Demo](https://i.v2ex.co/RO9M99Kkl.png)

**Live Demo:** [Watch this project being built in real-time](https://magali-flockless-rufina.ngrok-free.dev/?t=263643f46e602c190349472b)

> **Built-in sensitive data filtering** — API keys, tokens, passwords, and other secrets are automatically redacted from displayed content. However, **please review your session content before sharing** as automated filtering may not catch everything.

## Features

- Auto-discovers all Claude Code projects from `~/.claude/projects/`
- Live streaming via SSE — messages appear as they happen
- Project-based view with pagination and scroll navigation
- Share individual projects via token-protected URLs
- Displays user messages, assistant responses, thinking, tool calls and results
- Smart tool rendering: specialized formatters for Bash, Read, Write, Edit, Grep/Glob, Agent, TodoWrite, WebSearch
- Tool result detection: syntax-highlighted code, formatted JSON, diff with colors, rendered markdown
- Thinking blocks rendered as markdown with expand/collapse for long content
- Slash commands displayed as formatted terminal-style bubbles instead of raw XML
- Dark theme, monospace, mobile-friendly
- Automatic sensitive data redaction (API keys, tokens, passwords, private keys)

### Danmaku (Bullet Comments)

Shared pages support **danmaku** — real-time bullet comments that float across the screen, creating a live-stream atmosphere for viewers.

- **Send comments**: Type text or pick emoji from the input bar at the bottom of any shared page
- **Auto nickname**: A random Chinese adjective+noun nickname is generated on first visit, editable anytime (persisted in localStorage)
- **Live broadcast**: New comments are pushed to all viewers via SSE in real-time
- **History playback**: Past comments replay automatically when the page loads
- **Toggle on/off**: Dimmed toggle button, state saved across sessions
- **Performance**: Pure CSS animations, max 15 simultaneous comments on screen
- **Content limits**: 200 chars per comment, 20 chars per nickname, HTML-escaped for safety

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

Share tokens persist across server restarts — they only expire when explicitly revoked.

## Configuration

Environment variables (set in `.env` or shell):

| Variable | Default | Description |
|----------|---------|-------------|
| `CC_LIVE_PORT` | `3456` | Server port |
| `CLAUDE_DIR` | `~/.claude` | Claude config directory |
| `CC_LIVE_PUBLIC_URL` | — | Public tunnel URL for share links |
| `CC_LIVE_REDACT_<N>` | — | Custom redaction rules (see below) |

### Custom Redaction Rules

Add custom patterns beyond the built-in ones via `CC_LIVE_REDACT_1`, `CC_LIVE_REDACT_2`, etc.:

```bash
# Plain string — exact match replaced with ***REDACTED***
CC_LIVE_REDACT_1="my-company-internal-domain.com"

# Regex — /pattern/→replacement
CC_LIVE_REDACT_2="/\bmy-app-[a-z0-9]{12}\b/→***APP-ID***"
```

## How It Works

1. Scans `~/.claude/projects/` for JSONL session files (up to 50 projects, 7-day recency)
2. Loads last 200 messages per session as history, then tails for new content
3. Parses messages and streams via SSE to connected browsers
4. Every 10s rescans for new sessions

## Limitations

- Read-only — viewers cannot interact with the session
- Session data is in-memory only (up to 500 messages per session, then trimmed to 300)
- Share tokens persist across restarts (stored in `data/share-tokens.json`)

## License

MIT
