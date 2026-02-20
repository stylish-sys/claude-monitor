# Claude Multi-Agent Monitor

3개의 Claude Code CLI 인스턴스를 한 화면에서 실시간 모니터링하는 대시보드.

## 기능

- **4컬럼 레이아웃**: TASK | RESULT | USAGE | HISTORY
- **실시간 상태**: WORKING / IDLE / COMPLETE / OFFLINE
- **사용량 게이지**: 5시간 윈도우 / 주간 사용량 + 남은량
- **히스토리**: 과거 작업 + 답변 요약
- **서브에이전트 추적**: executor, explore 등 표시
- **서버 자동 재시작**: crash 시 2초 후 복구

## 설치

```bash
git clone <repo-url>
cd claude-monitor
npm install
```

## 설정

### 1. 에이전트 설정

```bash
cp config/agents.example.json config/agents.json
```

`config/agents.json`을 자신의 환경에 맞게 수정:

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

- `id`: 에이전트 고유 ID (hook에서 사용)
- `configDir`: Claude Code 설정 디렉토리 경로
- `plan`: 플랜 타입 (pro/max)
- `msgsLimit5h` / `msgsLimitWeek`: 메시지 한도 (게이지 표시용)

### 2. Hook 등록

각 Claude Code 인스턴스의 settings.json에 모니터링 hook을 추가합니다.

**자동 등록:**
```bash
node scripts/inject-hooks.mjs
```

**수동 등록** (settings.json에 직접 추가):

각 hook 이벤트(SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, Stop, SubagentStart, SubagentStop)에 아래 형식으로 추가:

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

- `MONITOR_AGENT_ID`: agents.json의 id와 일치시킬 것
- `MONITOR_PORT`: 서버 포트 (기본 7777)

### 3. 서버 시작

```bash
# 일반 시작
node server/index.mjs

# 자동 재시작 (권장)
bash start.sh
```

http://127.0.0.1:7777 에서 대시보드 확인.

## 구조

```
claude-monitor/
├── config/
│   ├── agents.json          # 에이전트 설정 (gitignore)
│   └── agents.example.json  # 템플릿
├── hooks/
│   └── monitor-forwarder.mjs # Hook → 서버 전송
├── scripts/
│   └── inject-hooks.mjs     # Hook 자동 등록
├── server/
│   ├── index.mjs            # Express + Socket.io
│   ├── db.mjs               # SQLite
│   └── routes.mjs           # REST API
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── start.sh                 # 자동 재시작 래퍼
└── data/                    # SQLite DB (자동생성)
```

## 요구사항

- Node.js 18+
- Claude Code CLI (각 인스턴스별 별도 설정 디렉토리)

## API

| Endpoint | 설명 |
|----------|------|
| `POST /api/events` | Hook 이벤트 수신 |
| `GET /api/agents` | 에이전트 상태 |
| `GET /api/usage` | 사용량 통계 (5h/weekly) |
| `GET /api/config` | 에이전트 설정 (민감정보 제외) |
| `GET /api/timeline` | 이벤트 타임라인 |

## License

MIT
