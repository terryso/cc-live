# CC Live

Real-time viewer for Claude Code / Codex sessions. Share a URL, let people watch your development process live.

## How it works

1. Tails Claude Code's local JSONL session files (`~/.claude/projects/`)
2. Parses messages and streams them via SSE to connected browsers
3. Use `cloudflared tunnel` for a public share URL

Works with `claude`, `happy claude`, and `happy codex` — anything that writes CC JSONL.

## Usage

```bash
# Start the watcher
cd ~/projects/cc-live
node server.js

# In another terminal, create a public URL
cloudflared tunnel --url http://localhost:3456
```

Open `http://localhost:3456` locally, or share the cloudflare URL with anyone.

## Config

| Env var | Default | Description |
|---------|---------|-------------|
| `CC_LIVE_PORT` | `3456` | Server port |
| `CLAUDE_DIR` | `~/.claude` | Claude config directory |

## Limitations

- Only watches the 20 most recently modified session files
- Shows messages from when the server started (not full history)
- Read-only — viewers cannot interact with the session
