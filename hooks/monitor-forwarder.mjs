#!/usr/bin/env node
/**
 * Monitor Forwarder Hook
 * Reads hook stdin data and forwards it to the monitor dashboard server via HTTP POST.
 * Always outputs {"continue": true} to avoid blocking Claude Code.
 */

const AGENT_ID = process.env.MONITOR_AGENT_ID || 'unknown';
const PORT = process.env.MONITOR_PORT || '7777';
const HOOK_EVENT = process.env.MONITOR_HOOK_EVENT || 'unknown';
const SERVER_URL = `http://127.0.0.1:${PORT}/api/events`;

// Inline readStdin (from ~/.claude/hooks/lib/stdin.mjs pattern)
async function readStdin(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        process.stdin.removeAllListeners();
        process.stdin.destroy();
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    }, timeoutMs);

    process.stdin.on('data', (chunk) => {
      chunks.push(chunk);
    });

    process.stdin.on('end', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    });

    process.stdin.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve('');
      }
    });

    if (process.stdin.readableEnded) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        resolve(Buffer.concat(chunks).toString('utf-8'));
      }
    }
  });
}

async function forward(data) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_id: AGENT_ID,
        hook_event: HOOK_EVENT,
        timestamp: new Date().toISOString(),
        data
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
  } catch {
    // Fire-and-forget: server might be down, that's OK
  }
}

// Suppress EPIPE on stdout (pipe consumer may close early)
process.stdout.on('error', () => {});

async function main() {
  const raw = await readStdin();
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = { raw_input: raw };
  }

  // Forward asynchronously, don't await
  forward(parsed);

  // Always allow Claude Code to continue
  process.stdout.write(JSON.stringify({ continue: true }));
}

main();
