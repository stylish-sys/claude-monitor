# Claude Multi-Agent Monitor

Real-time monitoring dashboard for multiple Claude Code CLI instances on a single screen.

![Dashboard](https://img.shields.io/badge/status-active-brightgreen) ![Node](https://img.shields.io/badge/node-18%2B-blue) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **4-Column Layout**: TASK | RESULT | USAGE | HISTORY side by side
- **Real-time Status**: WORKING / IDLE / COMPLETE / OFFLINE per agent
- **Usage Gauges**: 5-hour window & weekly usage with remaining quota
- **History**: Past tasks with answer summaries
- **Subagent Tracking**: Shows executor, explore, and other delegated agents
- **Auto-restart**: Server recovers automatically after crash (2s delay)
- **Secure**: Account credentials never exposed via API or frontend

## Quick Start

```bash
git clone https://github.com/stylish-sys/claude-monitor.git
cd claude-monitor
npm install
cp config/agents.example.json config/agents.json
```

## Setup

### 1. Configure Agents

Edit `config/agents.json` with your environment:

```json
{
  "agents": [
    {
      "id": "agent-1",
      "name": "Claude-1",
      "account": "your-email@example.com",
      "configDir": "~/.claude-1",
      "color": "#6366f1",
      "tmuxSession": "agent-1",
      "plan": "max",
      "msgsLimit5h": 200,
      "msgsLimitWeek": 2000
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique agent ID (used in hooks) |
| `configDir` | Claude Code config directory path (e.g. `~/.claude-1`) |
| `plan` | Plan type: `pro` or `max` |
| `msgsLimit5h` | Message limit per 5-hour window (for gauge display) |
| `msgsLimitWeek` | Weekly message limit (for gauge display) |
| `color` | Agent color in dashboard (hex) |

### 2. Register Hooks

Add monitoring hooks to each Claude Code instance's `settings.json`.

**Automatic (recommended):**
```bash
node scripts/inject-hooks.mjs
```

**Manual** (add to each hook event in settings.json):

Hook events to register: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SubagentStart`, `SubagentStop`

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "MONITOR_HOOK_EVENT=PreToolUse MONITOR_AGENT_ID=agent-1 MONITOR_PORT=7777 node \"/path/to/claude-monitor/hooks/monitor-forwarder.mjs\""
    }
  ]
}
```

- `MONITOR_AGENT_ID` must match the `id` in agents.json
- `MONITOR_PORT` defaults to 7777

### 3. Start Server

```bash
# Standard
node server/index.mjs

# With auto-restart (recommended)
bash start.sh
```

Open http://127.0.0.1:7777

## Architecture

```
Claude-1 (configDir: ~/.claude-1) ──hooks──> HTTP POST ──>
Claude-2 (configDir: ~/.claude-2) ──hooks──> HTTP POST ──> Dashboard Server ──WebSocket──> Browser
Claude-3 (configDir: ~/.claude-3) ──hooks──> HTTP POST ──>   (port 7777)
```

Each Claude Code session's hook events are captured and forwarded to a central server via HTTP POST. The server stores events in SQLite and broadcasts to the browser via WebSocket.

## Project Structure

```
claude-monitor/
├── config/
│   ├── agents.json            # Your agent config (gitignored)
│   └── agents.example.json    # Template
├── hooks/
│   └── monitor-forwarder.mjs  # Hook stdin → HTTP POST forwarder
├── scripts/
│   └── inject-hooks.mjs       # Auto-inject hooks into settings.json
├── server/
│   ├── index.mjs              # Express + Socket.io server
│   ├── db.mjs                 # SQLite schema + queries
│   └── routes.mjs             # REST API routes
├── public/
│   ├── index.html             # Dashboard HTML
│   ├── style.css              # Dark theme styles
│   └── app.js                 # Socket.io client + DOM
├── start.sh                   # Auto-restart wrapper
├── setup.sh                   # tmux session manager
└── data/                      # SQLite DB (auto-created)
```

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/events` | POST | Receive hook events |
| `/api/agents` | GET | Agent statuses |
| `/api/usage` | GET | Usage stats (5h/weekly) |
| `/api/config` | GET | Agent config (sensitive fields filtered) |
| `/api/timeline` | GET | Event timeline |
| `/api/tasks` | GET | Task list |

## Requirements

- Node.js 18+
- Claude Code CLI with separate config directories per instance

## Tech Stack

- **Server**: Express 5 + Socket.io 4
- **Database**: better-sqlite3
- **Frontend**: Vanilla HTML/CSS/JS (no build step)
- **Dependencies**: Only 3 packages (express, better-sqlite3, socket.io)

## License

MIT
