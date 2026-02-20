import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'data', 'monitor.db');

const db = new Database(DB_PATH);

// WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    hook_event TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT,
    tool_input TEXT,
    tool_response TEXT,
    stop_reason TEXT,
    last_message TEXT,
    raw_data TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_status (
    agent_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'offline',
    current_session_id TEXT,
    current_tool TEXT,
    last_event_at TEXT,
    tool_call_count INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    session_id TEXT,
    tool_name TEXT,
    tool_input_summary TEXT,
    status TEXT DEFAULT 'running',
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    result_preview TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
  CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`);

// Prepared statements
const insertEvent = db.prepare(`
  INSERT INTO events (agent_id, hook_event, timestamp, session_id, tool_name, tool_input, tool_response, stop_reason, last_message, raw_data)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const upsertAgentStatus = db.prepare(`
  INSERT INTO agent_status (agent_id, status, current_session_id, current_tool, last_event_at, tool_call_count, message_count, error_count)
  VALUES (?, ?, ?, ?, ?, 0, 0, 0)
  ON CONFLICT(agent_id) DO UPDATE SET
    status = excluded.status,
    current_session_id = COALESCE(excluded.current_session_id, current_session_id),
    current_tool = excluded.current_tool,
    last_event_at = excluded.last_event_at
`);

const incrementToolCount = db.prepare(`
  UPDATE agent_status SET tool_call_count = tool_call_count + 1 WHERE agent_id = ?
`);

const incrementMessageCount = db.prepare(`
  UPDATE agent_status SET message_count = message_count + 1 WHERE agent_id = ?
`);

const incrementErrorCount = db.prepare(`
  UPDATE agent_status SET error_count = error_count + 1 WHERE agent_id = ?
`);

const getAgentStatus = db.prepare(`SELECT * FROM agent_status WHERE agent_id = ?`);
const getAllAgentStatuses = db.prepare(`SELECT * FROM agent_status ORDER BY agent_id`);

const insertTask = db.prepare(`
  INSERT INTO tasks (agent_id, session_id, tool_name, tool_input_summary, status, started_at)
  VALUES (?, ?, ?, ?, 'running', ?)
`);

const completeTask = db.prepare(`
  UPDATE tasks SET status = ?, completed_at = ?, duration_ms = ?, result_preview = ?
  WHERE id = ?
`);

const getRunningTask = db.prepare(`
  SELECT * FROM tasks WHERE agent_id = ? AND tool_name = ? AND status = 'running' ORDER BY id DESC LIMIT 1
`);

const getTasksByAgent = db.prepare(`
  SELECT * FROM tasks WHERE agent_id = ? ORDER BY id DESC LIMIT ?
`);

const getAllTasks = db.prepare(`
  SELECT * FROM tasks ORDER BY id DESC LIMIT ?
`);

const getRecentEvents = db.prepare(`
  SELECT * FROM events ORDER BY id DESC LIMIT ?
`);

const getEventsByAgent = db.prepare(`
  SELECT * FROM events WHERE agent_id = ? ORDER BY id DESC LIMIT ?
`);

const markOfflineAgents = db.prepare(`
  UPDATE agent_status SET status = 'offline', current_tool = NULL
  WHERE last_event_at < ? AND status != 'offline'
`);

function truncate(str, maxLen = 500) {
  if (!str) return null;
  if (typeof str !== 'string') str = JSON.stringify(str);
  return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}

export function processEvent(payload) {
  const { agent_id, hook_event, timestamp, data } = payload;

  const sessionId = data?.session_id || data?.sessionId || null;
  const toolName = data?.tool_name || data?.toolName || null;
  const toolInput = truncate(data?.tool_input || data?.toolInput || data?.prompt || data?.message, 1000);
  const toolResponse = truncate(data?.tool_response || data?.toolResponse);
  const stopReason = data?.stop_reason || data?.stopReason || null;
  const lastMessage = truncate(data?.last_assistant_message || data?.last_message || data?.lastMessage, 2000);

  // Insert event
  const result = insertEvent.run(
    agent_id, hook_event, timestamp, sessionId,
    toolName, toolInput, toolResponse, stopReason, lastMessage,
    JSON.stringify(data)
  );

  // Determine status and tool based on hook event
  let status = 'active';
  let currentTool = null;

  switch (hook_event) {
    case 'SessionStart':
      status = 'idle';
      break;
    case 'UserPromptSubmit':
      status = 'active';
      break;
    case 'PreToolUse':
    case 'SubagentStart':
      status = 'tool_running';
      currentTool = toolName;
      break;
    case 'PostToolUse':
    case 'SubagentStop':
      status = 'active';
      break;
    case 'PostToolUseFailure':
      status = 'active';
      break;
    case 'Stop':
      status = 'idle';
      break;
  }

  // Upsert agent first (ensures row exists for increments)
  upsertAgentStatus.run(agent_id, status, sessionId, currentTool, timestamp);

  // Now increment counters and handle tasks
  switch (hook_event) {
    case 'UserPromptSubmit':
      incrementMessageCount.run(agent_id);
      break;
    case 'PreToolUse':
    case 'SubagentStart':
      incrementToolCount.run(agent_id);
      insertTask.run(agent_id, sessionId, toolName, truncate(toolInput, 200), timestamp);
      break;
    case 'PostToolUse':
    case 'SubagentStop': {
      const task = getRunningTask.get(agent_id, toolName);
      if (task) {
        const durationMs = new Date(timestamp).getTime() - new Date(task.started_at).getTime();
        completeTask.run('completed', timestamp, durationMs, truncate(toolResponse, 200), task.id);
      }
      break;
    }
    case 'PostToolUseFailure': {
      incrementErrorCount.run(agent_id);
      const failedTask = getRunningTask.get(agent_id, toolName);
      if (failedTask) {
        const durationMs = new Date(timestamp).getTime() - new Date(failedTask.started_at).getTime();
        completeTask.run('failed', timestamp, durationMs, truncate(toolResponse, 200), failedTask.id);
      }
      break;
    }
  }

  upsertAgentStatus.run(agent_id, status, sessionId, currentTool, timestamp);

  return {
    eventId: result.lastInsertRowid,
    agent_id,
    hook_event,
    timestamp,
    sessionId,
    toolName,
    toolInput,
    toolResponse,
    stopReason,
    lastMessage,
    agentStatus: status,
    currentTool
  };
}

export function getAgents() {
  return getAllAgentStatuses.all();
}

export function getAgent(agentId) {
  return getAgentStatus.get(agentId);
}

export function getTimeline(limit = 100) {
  return getRecentEvents.all(limit);
}

export function getAgentEvents(agentId, limit = 50) {
  return getEventsByAgent.all(agentId, limit);
}

export function getAgentTasks(agentId, limit = 50) {
  return getTasksByAgent.all(agentId, limit);
}

export function getAllTasksList(limit = 100) {
  return getAllTasks.all(limit);
}

// Windowed usage queries
const toolsInWindow = db.prepare(`
  SELECT COUNT(*) as cnt FROM events
  WHERE agent_id = ? AND hook_event IN ('PreToolUse','SubagentStart') AND timestamp > ?
`);

const msgsInWindow = db.prepare(`
  SELECT COUNT(*) as cnt FROM events
  WHERE agent_id = ? AND hook_event = 'UserPromptSubmit' AND timestamp > ?
`);

const errorsInWindow = db.prepare(`
  SELECT COUNT(*) as cnt FROM events
  WHERE agent_id = ? AND hook_event = 'PostToolUseFailure' AND timestamp > ?
`);

const subagentsForAgent = db.prepare(`
  SELECT tool_name, tool_input FROM events
  WHERE agent_id = ? AND hook_event = 'SubagentStart'
  ORDER BY id DESC LIMIT 5
`);

export function getAgentUsage(agentId) {
  const now = Date.now();
  const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  return {
    tools_5h: toolsInWindow.get(agentId, fiveHoursAgo)?.cnt || 0,
    msgs_5h: msgsInWindow.get(agentId, fiveHoursAgo)?.cnt || 0,
    errors_5h: errorsInWindow.get(agentId, fiveHoursAgo)?.cnt || 0,
    tools_week: toolsInWindow.get(agentId, weekAgo)?.cnt || 0,
    msgs_week: msgsInWindow.get(agentId, weekAgo)?.cnt || 0,
    errors_week: errorsInWindow.get(agentId, weekAgo)?.cnt || 0,
    recent_subagents: subagentsForAgent.all(agentId).map(r => ({
      name: r.tool_name,
      input: r.tool_input
    }))
  };
}

export function getAllAgentUsages() {
  const agents = getAllAgentStatuses.all();
  return agents.map(a => ({
    ...a,
    usage: getAgentUsage(a.agent_id)
  }));
}

export function checkOfflineAgents(thresholdMs = 60000) {
  const threshold = new Date(Date.now() - thresholdMs).toISOString();
  return markOfflineAgents.run(threshold);
}

export default db;
