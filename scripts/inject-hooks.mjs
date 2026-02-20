#!/usr/bin/env node
/**
 * Inject monitor hooks into all 3 Claude settings.json files.
 * Appends monitor-forwarder to each hook event array without removing existing hooks.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const MONITOR_DIR = resolve(import.meta.dirname, '..');
const FORWARDER = resolve(MONITOR_DIR, 'hooks', 'monitor-forwarder.mjs');
const PORT = '7777';

const AGENTS = [
  { id: 'agent-1', configDir: resolve(process.env.HOME, '.claude-1') },
  { id: 'agent-2', configDir: resolve(process.env.HOME, '.claude-2') },
  { id: 'agent-3', configDir: resolve(process.env.HOME, '.claude-3') },
];

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'SubagentStart',
  'SubagentStop',
];

function makeHookCommand(agentId, hookEvent) {
  return `MONITOR_HOOK_EVENT=${hookEvent} MONITOR_AGENT_ID=${agentId} MONITOR_PORT=${PORT} node "${FORWARDER}"`;
}

function isMonitorHook(hook) {
  return hook?.command?.includes('monitor-forwarder.mjs');
}

function injectHooks(agentId, settingsPath) {
  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch (err) {
    console.error(`  SKIP ${settingsPath}: ${err.message}`);
    return false;
  }

  if (!settings.hooks) settings.hooks = {};

  let changed = false;

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks[event]) {
      settings.hooks[event] = [];
    }

    const eventGroups = settings.hooks[event];

    // Check if monitor hook already exists in any group
    const alreadyInjected = eventGroups.some(group =>
      group.hooks?.some(isMonitorHook)
    );

    if (!alreadyInjected) {
      // Append a new hook group for the monitor
      eventGroups.push({
        hooks: [
          {
            type: 'command',
            command: makeHookCommand(agentId, event)
          }
        ]
      });
      changed = true;
      console.log(`  + ${event}`);
    } else {
      // Update existing monitor hook command (in case path changed)
      for (const group of eventGroups) {
        if (!group.hooks) continue;
        for (let i = 0; i < group.hooks.length; i++) {
          if (isMonitorHook(group.hooks[i])) {
            const newCmd = makeHookCommand(agentId, event);
            if (group.hooks[i].command !== newCmd) {
              group.hooks[i].command = newCmd;
              changed = true;
              console.log(`  ~ ${event} (updated)`);
            } else {
              console.log(`  = ${event} (unchanged)`);
            }
          }
        }
      }
    }
  }

  if (changed) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    console.log(`  -> Saved ${settingsPath}`);
  } else {
    console.log(`  -> No changes needed`);
  }

  return changed;
}

// --- Main ---
console.log('Claude Monitor - Hook Injection\n');

let totalChanged = 0;
for (const agent of AGENTS) {
  const settingsPath = resolve(agent.configDir, 'settings.json');
  console.log(`[${agent.id}] ${settingsPath}`);
  if (injectHooks(agent.id, settingsPath)) totalChanged++;
  console.log('');
}

console.log(`Done. ${totalChanged} file(s) modified.`);
console.log('Note: Restart Claude Code sessions for hooks to take effect.');
