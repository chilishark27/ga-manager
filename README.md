<p align="center">
  <img src="chilishark.png" width="120" alt="GA Manager" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  <strong>Multi-instance GenericAgent Desktop Manager</strong><br/>
  A single-binary desktop app to create, monitor, and orchestrate AI agent instances.
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#agent-modes">Agent Modes</a> •
  <a href="#management-tools">Tools</a> •
  <a href="#build-from-source">Build</a> •
  <a href="#api-reference">API</a>
</p>

---

## Quick Start

1. Download the binary for your platform from [Releases](https://github.com/chilishark27/ga-manager/releases)
2. Place it alongside the `bridge/` folder
3. Run `ga-manager` (or `ga-manager.exe` on Windows)
4. System tray icon appears — right-click to open the management panel

**Prerequisites:**
- [GenericAgent](https://github.com/lsdefine/GenericAgent) installed
- Python 3.10+ with GenericAgent dependencies
- A configured `mykey.py` in your GenericAgent directory

---

## Features

### Core Architecture

| Feature | Description |
|---------|-------------|
| **Single Binary** | HTTP server + system tray + embedded frontend — one file, no dependencies |
| **Multi-instance** | Run multiple GA agents simultaneously, each with isolated state and config |
| **Real-time Chat** | WebSocket streaming with full markdown rendering (code blocks, tables, math) |
| **Cross-platform** | Windows (systray), macOS (browser launch), Linux (browser launch) |
| **Headless Mode** | `--no-gui` flag for server-only deployment (no tray, no browser) |

### UI Design

| Feature | Description |
|---------|-------------|
| **Glassmorphism Theme** | Dark theme with backdrop-blur, gradient accents (#667eea → #764ba2), glow effects |
| **Light Theme** | Full component coverage with soft purple tints and proper contrast |
| **Resizable Panels** | Drag sidebar (180-400px) and right panel (240-500px) edges to resize |
| **Gradient Buttons** | Dark mode buttons have subtle gradient backgrounds; hover fills with full gradient |
| **i18n** | Chinese / English interface toggle |

---

## Agent Modes

### Autonomous Mode

| | |
|---|---|
| **What it does** | Agent works independently when you're away |
| **How it triggers** | After 30 minutes of user inactivity, the idle monitor fires |
| **What happens** | Agent reads `autonomous_operation_sop.md` and picks a task from its TODO list |
| **Use case** | Overnight monitoring, background research, periodic maintenance |

The agent follows a strict protocol: select task → execute (≤30 turns) → write report → mark complete. It won't touch core code or make irreversible changes without approval.

---

### Goal Mode

| | |
|---|---|
| **What it does** | Injects a persistent objective into every LLM call's system prompt |
| **Format** | `[当前目标] Your goal text here` appended to system prompt |
| **Use case** | Keep the agent focused on a specific domain across all conversations |

Example goals:
- `"You are a DevOps expert focused on K8s cluster operations"`
- `"Monitor stock prices for 002741, 603178, 600867 and alert on signals"`

---

### Reflect Mode

| | |
|---|---|
| **What it does** | Adds self-check instruction to system prompt |
| **Injection** | `[反射模式] 每次行动后自我检查：结果是否符合预期？是否需要修正方向？` |
| **Result** | Every response includes a `<summary>` tag with: what was done + what's next |
| **Use case** | Complex multi-step tasks where the agent needs to maintain direction |

```
Example output:
"Database migration script complete..."

<summary>Migration script generated covering 3 tables. Next: run tests to verify data integrity.</summary>
```

---

### Scheduler

| | |
|---|---|
| **What it does** | Triggers agent tasks on a cron schedule |
| **Two mechanisms** | 1) Go-side cron goroutines (UI-created tasks) 2) GA-native `reflect/scheduler.py` |
| **Task format** | JSON files in `sche_tasks/` directory with schedule, repeat, prompt fields |
| **Reports** | Execution reports written to `sche_tasks/done/YYYY-MM-DD_HHMM_taskname.md` |

Presets: Every 5min / 30min / hourly / daily 9:00 / daily 18:00 / weekdays 9:00

---

### Team Worker

| | |
|---|---|
| **What it does** | Connects agent to a shared collaboration board (BBS-style) |
| **Config** | Base URL + Board Key + Agent Name |
| **Behavior** | Agent polls the board for tasks, executes them, reports results via `on_done()` |
| **Use case** | Multiple agents working together — one posts tasks, others pick them up |

---

### Peer Hint

| | |
|---|---|
| **What it does** | Injects invisible system instructions to shape response style |
| **Injection** | Points agent to `temp/model_responses/` for peer session awareness |
| **Use case** | Let one agent know what another agent is doing (cross-session context) |

---

### Verbose Mode

| | |
|---|---|
| **What it does** | Controls output detail level in the bridge |
| **Enabled** | Shows full reasoning process, tool call logs |
| **Disabled** | Shows only final results |

---

## Management Tools

### Skill Tree

Force-directed graph visualization of the agent's memory system:
- **Nodes** = SOP files, Python scripts, index files in `memory/`
- **Node size** = usage frequency (from `file_access_stats.json`)
- **Node color** = type (SOP=blue, Script=green, Index=gold)
- **Edges** = cross-references and imports between files
- **Interaction** = drag nodes, zoom, click to open SOP editor

Shows how the agent's knowledge is structured and which SOPs are most used.

---

### SOP Editor

Full CRUD for Standard Operating Procedures:
- **Browse** — Tree view of `memory/` directory with collapsible folders
- **View** — Syntax-highlighted content viewer
- **Edit** — In-place editing with save (creates `.bak` backup)
- **Create** — New SOP with filename and content
- **Delete** — Soft delete (renames to `.deleted`)

---

### Token Statistics

Real-time token usage tracking per instance:
- **Input/Output tokens** — Cumulative count
- **Cache hit rate** — `cache_read / total_input × 100%`
- **History chart** — Last 20 calls visualized as bar chart
- **Source** — Parsed from bridge stdout `[Cache]` and `[Output]` log lines

---

### Task Replay

Step-by-step replay of agent sessions from `temp/model_responses/`:
- **Session list** — All recorded sessions sorted by date
- **Timeline view** — Each step shown with type indicator (thinking/tool_use/response)
- **Step navigation** — Previous/Next buttons, click any step to jump
- **Color coding** — Purple=thinking, Blue=tool_use, Green=prompt, White=response

---

### Agent Vision

Displays screenshots captured by the agent during visual operations:
- **Grid view** — Thumbnails of recent screenshots from `temp/` directory
- **Auto-scale** — Responsive grid with 16:9 aspect ratio
- **Click to open** — Full-size image in new tab
- **Purpose** — See what the agent "sees" when operating browser/desktop via screen capture

---

### ADB Control

Android device management for mobile automation:
- **Device list** — Connected devices with model, serial, status
- **Screenshot** — Capture device screen via `adb exec-out screencap`
- **Tap** — Send tap at coordinates
- **Swipe** — Send swipe gesture with duration

---

### Health Monitor

Background process that checks instance health every 30 seconds:
- **Detection** — Identifies crashed processes by PID
- **Auto-restart** — Automatically restarts crashed instances
- **Status** — Reports healthy/error/stopped per instance

---

### Memory Watcher

Monitors the `memory/` directory for changes every 30 seconds:
- **New SOP** — Broadcasts `sop_created` WebSocket event
- **Modified SOP** — Broadcasts `sop_updated` event
- **Frontend** — Skill tree auto-refreshes, toast notification shown

---

### Message Forward

Route messages between instances for multi-agent collaboration:
```
Instance A → "Please review this code" → Instance B
Instance B receives: "[来自实例 a1b2c3d4] Please review this code"
```

---

## Architecture

```
┌──────────────────────────────────────────┐
│         ga-manager (single binary)       │
├──────────────────────────────────────────┤
│  System Tray (Windows) / Browser Launch  │
│  HTTP Server (port 18600)                │
│  Embedded Frontend (React + Vite)        │
│  WebSocket Proxy (real-time streaming)   │
├──────────────────────────────────────────┤
│  bridge.py (stdin/stdout JSON protocol)  │
│  - Idle monitor (autonomous trigger)     │
│  - Scheduler monitor (cron tasks)        │
│  - Team worker monitor (BBS polling)     │
├──────────────────────────────────────────┤
│  GenericAgent (Python) × N instances     │
│  - 9 atomic tools (browser, terminal,    │
│    filesystem, keyboard, mouse, vision,  │
│    mobile/ADB, memory, ask_user)         │
│  - Self-evolving skill tree (SOPs)       │
│  - Hierarchical memory (L1-L4)           │
└──────────────────────────────────────────┘
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/instances` | List all instances |
| `POST` | `/api/instances` | Create instance |
| `DELETE` | `/api/instances/{id}` | Delete instance |
| `POST` | `/api/instances/{id}/start` | Start instance |
| `POST` | `/api/instances/{id}/stop` | Stop instance |
| `POST` | `/api/instances/{id}/chat` | Send message |
| `POST` | `/api/instances/{id}/interrupt` | Interrupt current task |
| `PATCH` | `/api/instances/{id}/config` | Update features (autonomous, goal, reflect, etc.) |
| `GET` | `/api/instances/{id}/ws` | WebSocket real-time stream |
| `GET` | `/api/instances/{id}/tokens` | Token usage statistics |
| `GET` | `/api/instances/{id}/tasks` | List scheduled tasks |
| `POST` | `/api/instances/{id}/tasks` | Add scheduled task |
| `GET` | `/api/instances/{id}/screenshots` | List agent screenshots |
| `GET` | `/api/instances/{id}/replay/sessions` | List replay sessions |
| `GET` | `/api/instances/{id}/replay/{file}` | Get parsed session steps |
| `GET` | `/api/skilltree` | Skill tree graph data (nodes + edges) |
| `GET` | `/api/sops/local` | List SOPs in memory/ |
| `PUT` | `/api/sops/local/{name}` | Update SOP content |
| `POST` | `/api/sops/local` | Create new SOP |
| `DELETE` | `/api/sops/local/{name}` | Delete SOP |
| `GET` | `/api/adb/devices` | List ADB devices |
| `GET` | `/api/adb/screenshot/{serial}` | Device screenshot |
| `POST` | `/api/adb/tap/{serial}` | Tap at coordinates |
| `GET` | `/api/config/llms` | List available LLM configs |
| `GET` | `/api/discover` | Scan for existing GA instances |

---

## Build from Source

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# Frontend
cd frontend && npm install && npm run build && cd ..
cp -r frontend/dist backend/static

# Build (pick your platform)
cd backend

# Windows (includes system tray)
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ../build/ga-manager.exe .

# macOS Apple Silicon
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../build/ga-manager .

# macOS Intel
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../build/ga-manager .

# Linux x64
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../build/ga-manager .
```

**Requirements:** Go 1.21+, Node.js 18+

---

## Configuration

On first run, GA Manager looks for `ga_manager_config.json` next to the binary:

```json
{
  "ga_root": "D:\\python3_project\\GenericAgent",
  "port": 18600,
  "max_instances": 10,
  "python_path": "python"
}
```

Or set via environment variables: `GA_ROOT`, `GA_MANAGER_PORT`.

---

## CLI Flags

| Flag | Description |
|------|-------------|
| `--no-gui` | Headless mode — HTTP server only, no system tray or browser window |

---

## Antivirus False Positive

Some antivirus software (Windows Defender, 360, etc.) may flag `ga-manager.exe` as suspicious. **This is a false positive.**

**Why it triggers:**
- The binary is an HTTP server that listens on a local port (18600)
- It spawns Python child processes (bridge.py → GenericAgent)
- It uses system tray APIs (Windows only)
- It's not code-signed (no purchased certificate)

**What we've done to minimize detections:**
- No registry writes (auto-start uses Startup folder .bat file)
- No `CreateMutex` (uses port-based singleton detection)
- No `GetConsoleWindow`/`ShowWindow` calls
- No `taskkill` or `powershell` invocations
- No `CREATE_NO_WINDOW` process creation flags
- All source code is open and auditable

**How to resolve:**
1. Add `ga-manager.exe` to your antivirus exclusion list
2. Or whitelist the folder where you placed it
3. Or build from source yourself — locally compiled binaries are less likely to be flagged

---

## Acknowledgments

Built on [GenericAgent](https://github.com/lsdefine/GenericAgent) by [@Ironman](https://github.com/lsdefine).

GenericAgent is a self-evolving AI agent framework that grows its skill tree from a minimal seed, achieving full system control with remarkable token efficiency. GA Manager exists to give this powerful framework a friendly face — making it easy to spin up multiple agents, monitor their work, and let them collaborate without touching the command line.

Thanks to Ironman and the GenericAgent community for building such an elegant and extensible agent system.

## License

MIT
