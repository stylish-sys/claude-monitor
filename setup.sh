#!/bin/bash
# Claude Multi-Agent Monitor - Session Manager
# Creates tmux sessions for the monitor server + 3 Claude agents

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=7777

echo "================================="
echo " Claude Monitor - Setup"
echo "================================="
echo ""

# 1. Install dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "[1/4] Installing dependencies..."
  cd "$SCRIPT_DIR" && npm install
  echo ""
else
  echo "[1/4] Dependencies already installed."
  echo ""
fi

# 2. Inject hooks into all 3 settings.json
echo "[2/4] Injecting monitor hooks..."
node "$SCRIPT_DIR/scripts/inject-hooks.mjs"
echo ""

# 3. Kill existing sessions (if any)
echo "[3/4] Setting up tmux sessions..."
for session in monitor-server agent-1 agent-2 agent-3; do
  tmux kill-session -t "$session" 2>/dev/null || true
done

# 4. Create tmux sessions
# Server session
tmux new-session -d -s monitor-server -c "$SCRIPT_DIR" \
  "node server/index.mjs; read -p 'Server stopped. Press Enter...'"
echo "  [+] monitor-server (port $PORT)"

sleep 1  # Wait for server to start

# Agent sessions
tmux new-session -d -s agent-1 -c "$HOME/dev/source" \
  -e "CLAUDE_CONFIG_DIR=$HOME/.claude-1"
echo "  [+] agent-1 (CLAUDE_CONFIG_DIR=~/.claude-1)"

tmux new-session -d -s agent-2 -c "$HOME/dev/source" \
  -e "CLAUDE_CONFIG_DIR=$HOME/.claude-2"
echo "  [+] agent-2 (CLAUDE_CONFIG_DIR=~/.claude-2)"

tmux new-session -d -s agent-3 -c "$HOME/dev/source" \
  -e "CLAUDE_CONFIG_DIR=$HOME/.claude-3"
echo "  [+] agent-3 (CLAUDE_CONFIG_DIR=~/.claude-3)"

echo ""
echo "================================="
echo " All sessions ready!"
echo "================================="
echo ""
echo " Dashboard:  http://127.0.0.1:$PORT"
echo ""
echo " tmux sessions:"
echo "   tmux attach -t monitor-server"
echo "   tmux attach -t agent-1"
echo "   tmux attach -t agent-2"
echo "   tmux attach -t agent-3"
echo ""
echo " To start Claude in each agent:"
echo "   tmux send-keys -t agent-1 'claude' Enter"
echo "   tmux send-keys -t agent-2 'claude' Enter"
echo "   tmux send-keys -t agent-3 'claude' Enter"
echo ""
