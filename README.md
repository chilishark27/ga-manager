<p align="center">
  <img src="chilishark.png" width="120" alt="GA Manager" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  <strong>Multi-instance GenericAgent Desktop Manager</strong><br/>
  Create, monitor, and orchestrate AI agent instances with a modern desktop UI.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#conductor">Conductor</a> •
  <a href="#dev-mode">Dev Mode</a> •
  <a href="#build-from-source">Build</a> •
  <a href="#update">Update</a>
</p>

---

## Quick Start

1. Download from [Releases](https://github.com/chilishark27/ga-manager/releases)
2. Run:
   - **Windows**: Double-click `GA Manager 2.0.0.exe`
   - **macOS**: Double-click `GA Manager-2.0.0.dmg` (需在 Mac 上构建)
   - **Linux**: Run `GA Manager-2.0.0.AppImage` (需在 Linux 上构建)

**Prerequisites:**
- [GenericAgent](https://github.com/lsdefine/GenericAgent) installed
- Python 3.10+ with GA dependencies
- Configured `mykey.py` in your GenericAgent directory
- For Conductor: `pip install fastapi uvicorn`

---

## Features

### Page Navigation Layout

| Page | Description |
|------|-------------|
| **Chat** | Full-width message stream, markdown rendering, image paste, session history |
| **Conductor** | Multi-agent orchestration — create/monitor/interact with subagents |
| **Monitor** | System CPU/memory, token stats, health status, Vision, ADB |
| **Skills** | Skill tree visualization + SOP editor |
| **Settings** | mykey.py editor, app config, theme/language |

### Left Sidebar

- Navigation items (Chat / Conductor / Monitor / Skills / Settings)
- Feature toggles (Autonomous / Reflect / Scheduler / Dev Mode)
- Session history with message preview (click to restore)
- Instance list with status indicators
- Theme / Language toggle
- Create / Scan buttons

### Agent Modes

| Mode | Description |
|------|-------------|
| **Autonomous** | Agent works independently after 30min idle, follows SOP |
| **Reflect** | Self-check after each action, maintains direction |
| **Scheduler** | Cron-based task execution |
| **Goal** | Persistent objective in system prompt (set via chat command) |
| **Dev Mode** | Development best practices injection (see below) |

---

## Conductor

Multi-agent orchestration powered by GA's `conductor.py`:

- **You only talk to Conductor Chat** (right panel) — it dispatches tasks to subagents
- **Click any subagent card** to view its full output (markdown rendered)
- **Real-time updates** — 1s polling + WebSocket, live reply streaming
- **Smart name extraction** — shows role name from prompt
- **State persistence** — subagent history cached locally

### How it works

1. Send a task in Conductor Chat (e.g. "设计一个中转站UI")
2. Conductor agent analyzes and dispatches to appropriate subagent
3. Subagent executes, status updates in real-time (running → stopped)
4. Conductor reviews output and reports back in Chat
5. You can continue the conversation to refine or assign new tasks

---

## Dev Mode

Toggle "开发模式" in the sidebar to inject development best practices:

**What it enforces (~80 tokens, system prompt level):**
1. Single module per reply, step-by-step delivery
2. Design interfaces/structure first, implement after confirmation
3. Single responsibility per module, files under 200 lines
4. Separation of Concerns, DRY, SOLID principles
5. Propose approach before writing code

**Works for:**
- Single agent chat (injected via bridge `extra_sys_prompt`)
- Conductor subagents (prefix injected on creation/messaging)

**Token cost:** ~80 tokens per turn (system prompt, not per-message)

---

## Update

Download the latest version from [Releases](https://github.com/chilishark27/ga-manager/releases) and replace the old file:

| Platform | Update Method |
|----------|---------------|
| Windows | Download new `GA Manager X.X.X.exe`, delete old one, run new one |
| macOS | Download new `.dmg`, drag to Applications (replace old) |
| Linux | Download new `.AppImage`, `chmod +x` and run |

Or rebuild from source:
```bash
cd ga-manager && git pull
cd frontend && npm run build && cd ..
cp -r frontend/dist backend/static
cd backend && go build -o ga-manager.exe .  # or ga-manager for unix
cd ../electron && npm run build:win  # or build:mac / build:linux
```

---

## Build from Source

### Prerequisites
- Go 1.21+
- Node.js 18+ & npm
- Python 3.10+
- Electron dependencies: `cd electron && npm install`

### Step 1: Build Frontend + Backend

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# Frontend
cd frontend && npm install && npm run build && cd ..
cp -r frontend/dist backend/static

# Backend (cross-compile all platforms)
cd backend
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/windows-amd64/ga-manager.exe .
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o ../build/darwin-arm64/ga-manager .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/linux-amd64/ga-manager .
cd ..
```

### Step 2: Build Electron (per platform)

Electron must be built **on the target platform**:

**Windows (on Windows):**
```powershell
cd electron
npm install
npm run build:win
# Output: build/electron/GA Manager 2.0.0.exe (portable, ~95MB)
```

**macOS (on macOS):**
```bash
cd electron
npm install
npm run build:mac
# Output: build/electron/GA Manager-2.0.0.dmg
```

**Linux (on Linux):**
```bash
cd electron
npm install
npm run build:linux
# Output: build/electron/GA Manager-2.0.0.AppImage
```

### CI/CD (all platforms)

For automated builds on all platforms, use GitHub Actions with a matrix:
```yaml
strategy:
  matrix:
    os: [windows-latest, macos-latest, ubuntu-latest]
```

---

## Architecture

```
┌──────────────────────────────────────────┐
│         ga-manager (Go binary)           │
├──────────────────────────────────────────┤
│  HTTP Server (port 18600)                │
│  Embedded Frontend (React + Vite)        │
│  WebSocket Proxy (real-time streaming)   │
│  Conductor Proxy (port 8900)             │
├──────────────────────────────────────────┤
│  bridge.py (stdin/stdout JSON protocol)  │
│  - Feature toggles (dev_mode, etc.)      │
│  - Idle/Scheduler/Team monitors          │
├──────────────────────────────────────────┤
│  GenericAgent (Python) × N instances     │
│  - 9 atomic tools                        │
│  - Self-evolving skill tree (SOPs)       │
│  - Hierarchical memory (L1-L4)           │
├──────────────────────────────────────────┤
│  Conductor (FastAPI, port 8900)          │
│  - Multi-agent orchestration             │
│  - Subagent lifecycle management         │
│  - Event-driven dispatch                 │
└──────────────────────────────────────────┘
```

---

## Credits

- [GenericAgent](https://github.com/lsdefine/GenericAgent) by @Ironman — the AI agent framework this manager wraps
- Built with Go, React, TypeScript, Electron
2. Extract the zip (contains `ga-manager` binary + `static/` + `bridge/`)
