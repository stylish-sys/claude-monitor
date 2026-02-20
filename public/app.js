/* Claude Monitor - 3-Column Dashboard */

const AGENTS = [
  { id: 'agent-1', name: 'Claude 1', color: '#6366f1' },
  { id: 'agent-2', name: 'Claude 2', color: '#22c55e' },
  { id: 'agent-3', name: 'Claude 3', color: '#f59e0b' },
];

const AGENT_MAP = {};
AGENTS.forEach(a => { AGENT_MAP[a.id] = a; });

// Plan limits (loaded from server config)
const PLAN = {};
AGENTS.forEach(a => { PLAN[a.id] = { msgsLimit5h: 200, msgsLimitWeek: 2000, plan: '?' }; });

const socket = io();

// Per-agent state
const jobs = {};
AGENTS.forEach(a => {
  jobs[a.id] = {
    conn: 'offline',
    status: 'idle',
    prompt: null,
    startedAt: null,
    toolCount: 0,
    lastTool: '',
    result: null,
    completedAt: null,
    durationMs: null,
    history: [],
    totalTools: 0, totalMessages: 0, totalErrors: 0,
    tools5h: 0, msgs5h: 0, errors5h: 0,
    toolsWeek: 0, msgsWeek: 0, errorsWeek: 0,
    activeSubagent: '',
    recentSubagents: [],
  };
});

const $list = document.getElementById('agentsList');
const $connDot = document.getElementById('connDot');
const $connLabel = document.getElementById('connLabel');
const $modalOverlay = document.getElementById('modalOverlay');
const $modalClose = document.getElementById('modalClose');
const $modalTitle = document.getElementById('modalTitle');
const $modalBody = document.getElementById('modalBody');

render();
fetchInit();

// Live elapsed timer
setInterval(() => {
  document.querySelectorAll('.elapsed-timer').forEach(el => {
    const j = jobs[el.dataset.agent];
    if (j && j.startedAt && j.status === 'working') {
      el.textContent = fmtDuration(Date.now() - new Date(j.startedAt).getTime());
    }
  });
}, 1000);

setInterval(fetchUsage, 15000);

// Socket
socket.on('connect', () => { $connDot.classList.add('connected'); $connLabel.textContent = 'Connected'; });
socket.on('disconnect', () => { $connDot.classList.remove('connected'); $connLabel.textContent = 'Disconnected'; });
socket.on('init', d => { d.agents?.forEach(a => applyAgentData(a)); render(); });
socket.on('agent_update', u => { if (jobs[u.agent_id]) { jobs[u.agent_id].conn = u.status || 'offline'; render(); } });
socket.on('agents_refresh', d => { d.agents?.forEach(a => applyAgentData(a)); render(); });
socket.on('event', ev => processEvent(ev));

$modalClose.addEventListener('click', () => $modalOverlay.classList.remove('open'));
$modalOverlay.addEventListener('click', e => { if (e.target === $modalOverlay) $modalOverlay.classList.remove('open'); });

function applyAgentData(a) {
  const j = jobs[a.agent_id];
  if (!j) return;
  j.conn = a.status || 'offline';
  j.totalTools = a.tool_call_count || 0;
  j.totalMessages = a.message_count || 0;
  j.totalErrors = a.error_count || 0;
  if (a.usage) {
    j.tools5h = a.usage.tools_5h || 0;
    j.msgs5h = a.usage.msgs_5h || 0;
    j.errors5h = a.usage.errors_5h || 0;
    j.toolsWeek = a.usage.tools_week || 0;
    j.msgsWeek = a.usage.msgs_week || 0;
    j.errorsWeek = a.usage.errors_week || 0;
    if (a.usage.recent_subagents?.length) {
      j.recentSubagents = a.usage.recent_subagents.map(s => shortName(s.name || ''));
    }
  }
}

async function fetchInit() {
  try {
    // Load config first
    const cfgRes = await fetch('/api/config');
    const cfg = await cfgRes.json();
    cfg.agents?.forEach(a => {
      if (PLAN[a.id]) {
        PLAN[a.id].msgsLimit5h = a.msgsLimit5h || 200;
        PLAN[a.id].msgsLimitWeek = a.msgsLimitWeek || 2000;
        PLAN[a.id].plan = a.plan || '?';
      }
      if (AGENT_MAP[a.id]) {
        AGENT_MAP[a.id].account = a.account || '';
      }
    });

    const [uRes, tRes] = await Promise.all([fetch('/api/usage'), fetch('/api/timeline?limit=500')]);
    // Timeline first (rebuilds task state), then usage (overlay stats)
    (await tRes.json()).reverse().forEach(ev => processEvent(toEv(ev), true));
    (await uRes.json()).forEach(a => applyAgentData(a));
    render();
  } catch {}
}

async function fetchUsage() {
  try {
    const res = await fetch('/api/usage');
    (await res.json()).forEach(a => applyAgentData(a));
    render();
  } catch {}
}

function toEv(r) {
  return { agent_id: r.agent_id, hook_event: r.hook_event, timestamp: r.timestamp,
    toolName: r.tool_name, toolInput: r.tool_input, toolResponse: r.tool_response,
    stopReason: r.stop_reason, lastMessage: r.last_message, sessionId: r.session_id };
}

// --- Event Processing ---
function processEvent(ev, silent = false) {
  const j = jobs[ev.agent_id];
  if (!j) return;

  switch (ev.hook_event) {
    case 'UserPromptSubmit': {
      archive(j);
      j.status = 'working';
      j.prompt = ev.toolInput || '';
      j.startedAt = ev.timestamp;
      j.toolCount = 0;
      j.lastTool = '';
      j.activeSubagent = '';
      j.result = null;
      j.completedAt = null;
      j.durationMs = null;
      break;
    }
    case 'PreToolUse':
      if (j.status === 'working') { j.toolCount++; j.lastTool = shortName(ev.toolName || ''); }
      break;
    case 'SubagentStart':
      if (j.status === 'working') {
        j.toolCount++;
        j.lastTool = shortName(ev.toolName || '');
        j.activeSubagent = shortName(ev.toolName || '');
      }
      break;
    case 'SubagentStop':
      j.activeSubagent = '';
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      break;
    case 'Stop':
      if (j.status === 'working' && j.prompt) {
        j.status = 'complete';
        j.completedAt = ev.timestamp;
        j.result = ev.lastMessage || ev.stopReason || '';
        j.lastTool = '';
        j.activeSubagent = '';
        if (j.startedAt) j.durationMs = new Date(ev.timestamp) - new Date(j.startedAt);
      }
      break;
    case 'SessionStart':
      archive(j);
      j.status = 'idle'; j.prompt = null; j.toolCount = 0; j.lastTool = ''; j.result = null; j.activeSubagent = '';
      break;
  }
  if (!silent) render();
}

function archive(j) {
  if (j.prompt && (j.status === 'working' || j.status === 'complete')) {
    j.history.unshift({
      prompt: j.prompt,
      result: j.result,
      durationMs: j.durationMs,
      toolCount: j.toolCount
    });
    if (j.history.length > 20) j.history.length = 20;
  }
}

// --- Render ---
function render() {
  $list.innerHTML = AGENTS.map(a => {
    const j = jobs[a.id];

    let badgeCls, badgeTxt;
    if (j.status === 'working') { badgeCls = 'working'; badgeTxt = 'WORKING'; }
    else if (j.status === 'complete') { badgeCls = 'complete'; badgeTxt = 'COMPLETE'; }
    else if (j.conn === 'offline') { badgeCls = 'offline'; badgeTxt = 'OFFLINE'; }
    else { badgeCls = 'idle'; badgeTxt = 'IDLE'; }

    const dotCls = j.status === 'working' ? 'working' : j.conn;

    const toolParts = [];
    if (j.activeSubagent) toolParts.push(`<span class="sub-agent">${esc(j.activeSubagent)}</span>`);
    if (j.lastTool && j.lastTool !== j.activeSubagent) toolParts.push(`<span class="cur-tool">${esc(j.lastTool)}</span>`);
    const toolHtml = toolParts.length ? `<div class="current-skill">${toolParts.join(' ')}</div>` : '';

    const elapsedHtml = j.status === 'working' && j.startedAt
      ? `<span class="elapsed-timer" data-agent="${a.id}">${fmtDuration(Date.now() - new Date(j.startedAt).getTime())}</span>` : '';

    return `
      <div class="agent-row" data-status="${j.status}">
        <div class="row-header" style="--agent-color: ${a.color}">
          <div class="row-name">
            <div class="status-dot ${dotCls}"></div>
            ${a.name}
          </div>
          <span class="status-badge ${badgeCls}">${badgeTxt}</span>
          ${toolHtml}
          ${elapsedHtml}
        </div>
        <div class="row-body">
          ${renderColTask(a.id, j)}
          ${renderColResult(a.id, j)}
          ${renderColUsage(a.id, j)}
          ${renderColHistory(j)}
        </div>
      </div>
    `;
  }).join('');

  bindEvents();
}

// Col 1: TASK
function renderColTask(aid, j) {
  if ((j.status === 'working' || j.status === 'complete') && j.prompt) {
    return `<div class="col col-task">
      <div class="section-label prompt">TASK</div>
      <div class="task-text">${esc(j.prompt)}</div>
      <div class="task-time">${fmtTime(j.startedAt)}</div>
      ${j.status === 'working' ? '<div class="progress-bar"><div class="progress-inner"></div></div>' : ''}
    </div>`;
  }
  return `<div class="col col-task"><div class="idle-msg">대기중</div></div>`;
}

// Col 2: RESULT
function renderColResult(aid, j) {
  if (j.status === 'working') {
    return `<div class="col col-result">
      <div class="section-label result">RESULT</div>
      <div class="waiting-msg">작업중...</div>
    </div>`;
  }
  if (j.status === 'complete' && j.result) {
    return `<div class="col col-result">
      <div class="section-label result">RESULT</div>
      <div class="result-text" data-agent="${aid}">${esc(truncate(j.result, 500))}</div>
      <div class="result-meta">
        <span class="result-duration">${fmtDuration(j.durationMs)} / ${j.toolCount} tools</span>
        <button class="ack-btn" data-agent="${aid}">확인</button>
      </div>
    </div>`;
  }
  return `<div class="col col-result"><div class="section-label result">RESULT</div><div class="idle-msg">-</div></div>`;
}

// Col 3: USAGE
function renderColUsage(aid, j) {
  const p = PLAN[aid];
  const pct5h = p.msgsLimit5h > 0 ? Math.min(100, Math.round(j.msgs5h / p.msgsLimit5h * 100)) : 0;
  const pctWeek = p.msgsLimitWeek > 0 ? Math.min(100, Math.round(j.msgsWeek / p.msgsLimitWeek * 100)) : 0;
  const remain5h = Math.max(0, p.msgsLimit5h - j.msgs5h);
  const remainWeek = Math.max(0, p.msgsLimitWeek - j.msgsWeek);
  const gaugeColor5h = pct5h > 80 ? 'var(--red)' : pct5h > 50 ? 'var(--amber)' : 'var(--green)';
  const gaugeColorWeek = pctWeek > 80 ? 'var(--red)' : pctWeek > 50 ? 'var(--amber)' : 'var(--green)';

  return `<div class="col col-usage">
    <div class="section-label usage-label">USAGE <span class="plan-tag">${esc(p.plan.toUpperCase())}</span></div>
    <div class="usage-block">
      <div class="usage-title">5H WINDOW</div>
      <div class="gauge-row">
        <div class="gauge-bar"><div class="gauge-fill" style="width:${pct5h}%;background:${gaugeColor5h}"></div></div>
        <span class="gauge-pct">${pct5h}%</span>
      </div>
      <div class="usage-row"><span>Messages</span><span class="uval">${j.msgs5h} / ${p.msgsLimit5h}</span></div>
      <div class="usage-row"><span>남은량</span><span class="uval remain">${remain5h}</span></div>
      <div class="usage-row"><span>Tools</span><span class="uval">${j.tools5h}</span></div>
      <div class="usage-row"><span>Errors</span><span class="uval ${j.errors5h > 0 ? 'uerr' : ''}">${j.errors5h}</span></div>
    </div>
    <div class="usage-block">
      <div class="usage-title">WEEKLY</div>
      <div class="gauge-row">
        <div class="gauge-bar"><div class="gauge-fill" style="width:${pctWeek}%;background:${gaugeColorWeek}"></div></div>
        <span class="gauge-pct">${pctWeek}%</span>
      </div>
      <div class="usage-row"><span>Messages</span><span class="uval">${j.msgsWeek} / ${p.msgsLimitWeek}</span></div>
      <div class="usage-row"><span>남은량</span><span class="uval remain">${remainWeek}</span></div>
      <div class="usage-row"><span>Tools</span><span class="uval">${j.toolsWeek}</span></div>
      <div class="usage-row"><span>Errors</span><span class="uval ${j.errorsWeek > 0 ? 'uerr' : ''}">${j.errorsWeek}</span></div>
    </div>
    ${j.toolCount > 0 ? `<div class="usage-current">현재 작업: <span class="uval">${j.toolCount}</span> tools</div>` : ''}
  </div>`;
}

// Col 4: HISTORY + Subagents
function renderColHistory(j) {
  const subHtml = j.recentSubagents.length
    ? `<div class="section-label">AGENTS</div><div class="subagent-list">${j.recentSubagents.slice(0, 5).map(s =>
        `<span class="subagent-chip">${esc(s)}</span>`
      ).join('')}</div>` : '';

  const histHtml = j.history.length
    ? `<div class="section-label" style="margin-top:${subHtml ? '8' : '0'}px">HISTORY</div>
       <div class="history-list">${j.history.slice(0, 8).map((h, i) =>
        `<div class="history-item" data-idx="${i}" data-prompt="${esc(h.prompt || '')}" data-result="${esc(truncate(h.result || '', 1000))}">
          <div class="hist-header">
            <span class="check">✓</span>
            <span class="hist-text">${esc(truncate(h.prompt || '', 30))}</span>
            ${h.durationMs ? `<span class="hist-dur">${fmtDuration(h.durationMs)}</span>` : ''}
          </div>
          ${h.result ? `<div class="hist-answer">${esc(truncate(h.result, 80))}</div>` : ''}
        </div>`
      ).join('')}</div>` : '';

  return `<div class="col col-history">${subHtml}${histHtml}</div>`;
}

function bindEvents() {
  $list.querySelectorAll('.ack-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const j = jobs[btn.dataset.agent];
      if (j.status === 'complete') {
        archive(j);
        j.status = 'idle'; j.prompt = null; j.result = null; j.toolCount = 0;
        render();
      }
    });
  });
  $list.querySelectorAll('.result-text').forEach(el => {
    el.addEventListener('click', () => {
      const j = jobs[el.dataset.agent];
      const ag = AGENT_MAP[el.dataset.agent];
      showModal(ag.name, j.prompt, j.result, j.durationMs, j.toolCount);
    });
  });
  $list.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const prompt = el.dataset.prompt;
      const result = el.dataset.result;
      showModal('History', prompt, result, null, null);
    });
  });
}

function showModal(name, prompt, result, dur, tools) {
  $modalTitle.textContent = name;
  $modalBody.innerHTML = `
    <label>Task</label><pre>${esc(prompt || '')}</pre>
    <label>Result</label><pre>${esc(result || '')}</pre>
    ${dur != null ? `<label>Info</label><pre>${fmtDuration(dur)}${tools != null ? ' / ' + tools + ' tools' : ''}</pre>` : ''}
  `;
  $modalOverlay.classList.add('open');
}

function shortName(n) {
  if (!n) return '';
  if (n.startsWith('mcp__')) return n.split('__').pop();
  return n;
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return '0s';
  if (ms < 1000) return ms + 'ms';
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return m + 'm ' + rs + 's';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + 'h ' + rm + 'm';
}

function truncate(s, n) { return !s ? '' : s.length > n ? s.slice(0, n) + '...' : s; }

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
}
