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
  <a href="#build-from-source">Build</a> •
  <a href="https://github.com/lsdefine/GenericAgent">GenericAgent</a>
</p>

---

## Quick Start

1. Download the binary for your platform from [Releases](https://github.com/chilishark27/ga-manager/releases)
2. Place it alongside the `bridge/` folder
3. Run `ga-manager` (or `ga-manager.exe` on Windows)
4. The system tray icon appears — click "Open Panel" or visit `http://localhost:18600`

**Prerequisites:**
- [GenericAgent](https://github.com/lsdefine/GenericAgent) installed
- Python 3.10+ with GenericAgent dependencies
- A configured `mykey.py` in your GenericAgent directory

---

## Features

### Core
- **Single Binary** — HTTP server + system tray + embedded frontend in one executable
- **Multi-instance** — Run multiple GA agents simultaneously with isolated state
- **Real-time Chat** — WebSocket streaming with markdown rendering
- **Cross-platform** — Windows (systray), macOS, Linux

### Agent Modes
| Mode | Description |
|------|-------------|
| **Autonomous** | Agent works independently after 30 min idle |
| **Goal** | Persistent objective injected into system prompt |
| **Reflect** | Self-check after each action with `<summary>` tags |
| **Scheduler** | Cron-based recurring tasks |
| **Team Worker** | Multi-agent collaboration via shared board |
| **Peer Hint** | System-level instructions for response style |

### Management
- **Skill Tree** — Force-directed graph visualization of SOPs and their dependencies
- **SOP Editor** — Browse, create, edit, delete Standard Operating Procedures
- **Token Stats** — Track input/output tokens and cache hit rate
- **Task Replay** — Step-by-step replay of agent sessions
- **ADB Control** — Android device listing, screenshots, tap/swipe
- **Agent Vision** — View screenshots captured by the agent
- **Health Monitor** — Auto-detect crashed instances and restart
- **Memory Watcher** — Real-time notifications when new SOPs are created

### UI
- Glassmorphism dark theme with purple/indigo gradient accents
- Light theme with full component coverage
- Resizable sidebar and right panel (drag edges)
- Collapsible SOP sections
- i18n (Chinese / English)

---

## Architecture

```
┌──────────────────────────────────────────┐
│         ga-manager (single binary)       │
├──────────────────────────────────────────┤
│  System Tray (Windows) / Browser Launch  │
│  HTTP Server (port 18600)                │
│  Embedded Frontend (React + Vite)        │
│  WebSocket Proxy                         │
├──────────────────────────────────────────┤
│  bridge.py (stdin/stdout JSON protocol)  │
├──────────────────────────────────────────┤
│  GenericAgent (Python) × N instances     │
└──────────────────────────────────────────┘
```

---

## Build from Source

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# Frontend
cd frontend && npm install && npm run build && cd ..

# Copy static files
cp -r frontend/dist backend/static

# Build (pick your platform)
cd backend

# Windows
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ../build/ga-manager.exe .

# macOS Apple Silicon
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../build/ga-manager .

# macOS Intel
GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../build/ga-manager .

# Linux
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
| `--no-gui` | Headless mode (HTTP server only, no system tray or browser) |

---

## Antivirus False Positive

Some antivirus software (Windows Defender, 360, etc.) may flag `ga-manager.exe` as suspicious. **This is a false positive.** Here's why it happens and how to resolve it:

**Why it triggers:**
- The binary is an HTTP server that listens on a local port (18600)
- It spawns Python child processes (bridge.py → GenericAgent)
- It uses system tray APIs (Windows only)
- It's not code-signed (no purchased certificate)

These are all legitimate behaviors for a local development tool, but the combination matches heuristic patterns that antivirus engines associate with malware.

**What we've done to minimize detections:**
- No registry writes (auto-start uses Startup folder .bat file)
- No `CreateMutex` (uses port-based singleton detection)
- No `GetConsoleWindow`/`ShowWindow` calls (uses `-H windowsgui` linker flag)
- No `taskkill` or `powershell` invocations
- No `CREATE_NO_WINDOW` process creation flags
- All source code is open and auditable

**How to resolve:**
1. Add `ga-manager.exe` to your antivirus exclusion list
2. Or whitelist the folder where you placed it
3. Or build from source yourself — the binary you compile locally is less likely to be flagged

> The project is fully open source. You can audit every line of code in this repository.

---

## Acknowledgments

Built on [GenericAgent](https://github.com/lsdefine/GenericAgent) by [@lsdefine](https://github.com/lsdefine).

## License

MIT
