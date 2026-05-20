<p align="center">
  <img src="frontend/public/app.png" width="120" alt="GA Manager" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  <strong>Multi-instance GenericAgent Desktop Manager</strong><br/>
  Create, monitor, and orchestrate AI agent instances with a modern desktop UI.
</p>

<p align="center">
  <a href="README_zh.md">中文文档</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#usage-guide">Usage Guide</a> •
  <a href="#build-from-source">Build</a>
</p>

---

## Quick Start

1. Download from [Releases](https://github.com/chilishark27/ga-manager/releases)
2. Install:
   - **Windows**: Run `GA-Manager-X.X.X-x64.exe` — one-click silent install
   - **macOS**: Open `.dmg`, drag to Applications. First launch: right-click → "Open"
   - **Linux**: `chmod +x GA-Manager-*.AppImage && ./GA-Manager-*.AppImage`
3. First-run Setup Wizard will guide you to configure GA Root path
4. Click "Validate" to verify your environment, then "Get Started"

**Prerequisites:**
- [GenericAgent](https://github.com/lsdefine/GenericAgent) installed
- Python 3.10+ (python or python3 in PATH, or configure full path)
- Configured `mykey.py` in your GenericAgent directory

---

## Features

| Feature | Description |
|---------|-------------|
| **Chat** | Real-time conversation with Agent, markdown rendering, image paste, session history |
| **Conductor** | Multi-agent orchestration — create subagents, coordinate complex tasks |
| **Hive** | Goal-based multi-agent collaboration via BBS message board |
| **Monitor** | Token cost tracking, system resources (CPU/Memory) |
| **Skills** | Skill tree visualization + SOP file editor |
| **TODO Widget** | Floating task list — manual add, auto-detect from Agent replies, execute via Agent/Hive |
| **Auto Update** | Automatic update detection, download, and silent install |

---

## Usage Guide

### 1. Setup & Configuration

On first launch, the Setup Wizard appears:
- **GA Root**: Path to your GenericAgent directory (contains `agentmain.py`)
- **Python Path** (optional): Leave empty for auto-detection, or specify full path
- Click **Validate** to check: GA path ✓, Python ✓, Bridge ✓
- Click **Get Started** to save

To reconfigure later: **Settings → Reconfigure** button

### 2. Creating Instances

1. Click **+ New** in the sidebar
2. Enter instance name (optional, auto-generated if empty)
3. GA Root auto-fills from your configuration
4. Select LLM model (reads from your `mykey.py`)
5. Click **Create** — instance starts automatically

### 3. Chat

- Type messages in the input area, press Enter or click Send
- **Image paste**: Ctrl+V to paste screenshots directly
- **Session history**: Click any session in the sidebar to restore
- **Double-click** a session to rename it
- **Search**: Use the search box in History section
- **Review**: Click "Review" button to run code review on uncommitted changes

### 4. Feature Toggles (Sidebar)

Click to enable/disable for the active instance:

| Toggle | What it does |
|--------|-------------|
| **Autonomous** | Agent works independently after 30min idle |
| **Reflect** | Self-check after each action, maintains direction |
| **Scheduler** | Cron-based scheduled task execution |
| **Dev Mode** | Injects development best practices into system prompt |

### 5. Conductor (Multi-Agent Orchestration)

**What**: Create multiple sub-agents working in parallel, coordinated by a conductor.

**How to use**:
1. Go to **Conductor** page
2. Click **Start Conductor** (auto-installs dependencies if needed)
3. Type a task in the chat panel (right side)
4. Conductor analyzes and dispatches to sub-agents
5. Click any sub-agent card to view its full output
6. Continue chatting to refine or assign new tasks

**Best for**: Complex tasks that can be split into parallel subtasks (e.g., "Design a REST API with docs, tests, and deployment config")

**Port**: Auto-detects available port (default 8900, falls back if occupied)

### 6. Hive (Goal Collaboration)

**What**: Multiple Agent workers collaborate via a shared BBS message board toward a common goal.

**How to use**:
1. Go to **Hive** page
2. Enter your objective (e.g., "Research and summarize top 5 AI frameworks")
3. Set time budget (minutes) and number of workers
4. Click **Start Hive**
5. Watch the message stream as workers coordinate
6. Send additional instructions via the message input

**Best for**: Research tasks, information gathering, tasks requiring multiple perspectives

**Requirements**: `pip install fastapi uvicorn python-multipart` (auto-installed on first use)

### 7. TODO Widget

A floating task card that stays visible on all pages:

- **Drag** the title bar to move it anywhere
- **Click** title to collapse/expand
- **Add tasks**: Type in the input box, press Enter
- **Complete**: Check the checkbox
- **Delete**: Hover and click ×
- **Auto-detect**: When Agent replies contain "TODO:", "待办:", "需要:" etc., suggestions appear
- **Auto-complete**: When Agent reports a task as done, it's automatically checked off
- **Execute all**: Click ▶ button to choose execution mode:
  - **Send to Agent** — sends task list to current chat
  - **Auto Execute** — Agent works autonomously
  - **Hive Mode** — starts Hive with tasks as objective
- **Archive**: Click "Archive Done" to let Agent summarize completed tasks

**Persistence**: Tasks saved to backend (`~/.ga-manager/todos.json`), survives restarts

### 8. Monitor

- **Cost Tracking**: Requests, Input/Output tokens, Cache hit rate, Duration, Total
- **System Resources**: CPU and Memory usage bars
- Data refreshes every 5 seconds

### 9. Skills & SOP

- **Left panel**: Browse SOP files from GA's `memory/` directory
- **Right panel**: View/edit SOP content, or view the Skill Tree visualization
- **Create**: Click "+ New" to create a new SOP file

### 10. Settings

- **Theme**: Dark / Light
- **Language**: English / Chinese
- **App Config**: GA Root, Python path, Port
- **mykey.py Editor**: Edit LLM API keys directly
- **Check Updates**: Manual update check
- **Reconfigure**: Re-enter Setup Wizard

### 11. Auto Update

- App checks for updates on startup (after 15s) and every hour
- When a new version is found, a notification appears at bottom-right
- Click **Download** to start downloading
- When ready, click **Restart Now** to install immediately
- Or click **Install on Quit** for silent install on next exit

---

## Build from Source

### Prerequisites
- Go 1.21+
- Node.js 18+ & npm
- Python 3.10+

### Build

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# Frontend
cd frontend && npm install && npm run build && cd ..

# Backend (choose your platform)
cd backend
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/windows-amd64/ga-manager.exe .
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o ../build/darwin-arm64/ga-manager .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/linux-amd64/ga-manager .
cd ..

# Electron (on target platform)
cd electron && npm install
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### Run without Electron (development)

```bash
cp -r frontend/dist backend/static
cd backend && go run . --no-gui
# Open http://localhost:18600
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│  Electron (Desktop Shell)                   │
│  - Auto-update (electron-updater)           │
│  - System tray, folder picker               │
├─────────────────────────────────────────────┤
│  Go Backend (port 18600)                    │
│  - REST API + WebSocket                     │
│  - Instance lifecycle management            │
│  - Conductor/Hive process management        │
│  - Cost persistence (~/.ga-manager/)        │
├─────────────────────────────────────────────┤
│  bridge.py (stdin/stdout JSON protocol)     │
│  - Spawns GenericAgent per instance         │
│  - Feature toggles, cost tracking           │
├─────────────────────────────────────────────┤
│  GenericAgent (Python) × N instances        │
│  - LLM interaction, tool execution          │
│  - Self-evolving skill tree (SOPs)          │
│  - Hierarchical memory                      │
├─────────────────────────────────────────────┤
│  Conductor (FastAPI, dynamic port)          │
│  Hive BBS (FastAPI, random port 58800+)     │
└─────────────────────────────────────────────┘
```

---

## Credits

- [GenericAgent](https://github.com/lsdefine/GenericAgent) — the AI agent framework
- Built with Go, React, TypeScript, Electron
