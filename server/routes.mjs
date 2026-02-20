import { Router } from 'express';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import {
  processEvent,
  getAgents,
  getAgent,
  getTimeline,
  getAgentEvents,
  getAgentTasks,
  getAllTasksList,
  getAllAgentUsages
} from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// Serve agent config (includes plan limits)
let agentConfig = null;
try {
  agentConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', 'agents.json'), 'utf-8'));
} catch {}

router.get('/config', (req, res) => {
  // Filter out sensitive fields (account, configDir)
  const safe = {
    agents: (agentConfig?.agents || []).map(a => ({
      id: a.id,
      name: a.name,
      color: a.color,
      plan: a.plan,
      msgsLimit5h: a.msgsLimit5h,
      msgsLimitWeek: a.msgsLimitWeek,
    }))
  };
  res.json(safe);
});

// Receive hook events
router.post('/events', (req, res) => {
  try {
    const processed = processEvent(req.body);

    // Broadcast via Socket.io (attached in index.mjs)
    if (req.app.get('io')) {
      req.app.get('io').emit('event', processed);
      req.app.get('io').emit('agent_update', {
        agent_id: processed.agent_id,
        status: processed.agentStatus,
        current_tool: processed.currentTool,
        last_event_at: processed.timestamp,
        hook_event: processed.hook_event
      });
    }

    res.json({ ok: true, eventId: processed.eventId });
  } catch (err) {
    console.error('Event processing error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all agent statuses
router.get('/agents', (req, res) => {
  res.json(getAgents());
});

// Get single agent status
router.get('/agents/:id', (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

// Get agent tasks
router.get('/agents/:id/tasks', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getAgentTasks(req.params.id, limit));
});

// Get agent events
router.get('/agents/:id/events', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getAgentEvents(req.params.id, limit));
});

// Get unified timeline
router.get('/timeline', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getTimeline(limit));
});

// Get all tasks
router.get('/tasks', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getAllTasksList(limit));
});

// Get all agents with usage stats
router.get('/usage', (req, res) => {
  res.json(getAllAgentUsages());
});

export default router;
