#!/bin/bash
# Auto-restart monitor server on crash
cd "$(dirname "$0")"

while true; do
  echo "[$(date)] Starting Claude Monitor server..."
  node server/index.mjs
  EXIT_CODE=$?
  if [ $EXIT_CODE -eq 0 ]; then
    echo "[$(date)] Server exited cleanly."
    break
  fi
  echo "[$(date)] Server crashed (exit $EXIT_CODE). Restarting in 2s..."
  sleep 2
done
