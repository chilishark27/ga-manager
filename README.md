<p align="center">
  <img src="chilishark.png" width="280" alt="ChiliShark" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  A desktop management UI for <a href="https://github.com/chilishark27/GenericAgent">GenericAgent</a> — create, monitor, and control GA instances with a modern dark-themed interface.
</p>

<p align="center">
  <img src="screenshots/main_zh.png" alt="GA Manager Screenshot" width="800" />
</p>

## Features

- 🖥️ **Instance Management** — Create, start, stop, and delete GA instances
- 💬 **Chat Interface** — Send messages to instances, view markdown-rendered responses
- 🎯 **Goal Mode** — Set long-term goals that persist across conversations
- 🤝 **Peer Hint** — Inject behavioral constraints (e.g. "reply within 20 chars")
- 🪞 **Reflect Mode** — GA auto-appends self-reflection after each response
- 🤖 **Autonomous Mode** — GA autonomously executes tasks using tools
- 🔀 **Message Forward** — Route messages between instances for multi-agent collaboration
- ⏰ **Scheduled Tasks** — Cron-based task scheduling with preset templates
- 📦 **SOP Hub** — Search and download SOPs from the community hub
- 🌐 **Multi-language** — Chinese (中文) and English, switchable in sidebar
- 🎨 **Dark Theme** — Easy on the eyes with a modern UI

## Feature Toggle Demos

All feature toggles have been verified end-to-end. Here are the actual demo results:

### 1. 🎯 Goal Mode

Set a persistent goal that GA remembers across turns.

```
API: POST /api/instances/{id}/config
Body: {"goal": "监控CPU温度并在超过80度时报警"}

User: "你的目标是什么？"
GA Response: "我的长期目标是：监控CPU温度，并在超过80°C时发出报警。
具体需要实现：1.持续读取CPU温度数据 2.设定80°C阈值 3.超温时触发报警通知"
```

### 2. 🤝 Peer Hint

Inject behavioral constraints into GA's system prompt.

```
API: POST /api/instances/{id}/config
Body: {"peer_hint": "用户喜欢简洁回复，不超过20字"}

User: "Python是什么？"
GA Response: "通用高级编程语言，简洁易读。" (26 chars vs normal 200+ chars)
```

### 3. 🪞 Reflect Mode

GA automatically appends self-reflection after each response.

```
API: POST /api/instances/{id}/config
Body: {"reflect": true}

User: "解释什么是递归"
GA Response: "递归是函数调用自身的编程技术..."
<reflect>本次回答：结构清晰，用了阶乘例子...
不足之处：未提及尾递归优化...
下次必须避免：过于抽象的解释</reflect>
```

### 4. 🤖 Autonomous Mode

GA autonomously plans and executes tasks using available tools.

```
API: POST /api/instances/{id}/config
Body: {"autonomous": true, "goal": "创建test_auto.txt并写入hello world"}

Result: GA automatically called file_write tool and created the file.
Verified: test_auto.txt exists with content "hello world"
```

### 5. 🔀 Message Forward

Route messages between instances for multi-agent collaboration.

```
API: POST /api/instances/{id}/forward
Body: {"target_id": "<inst-B-id>", "message": "请用一句话介绍Python的优点"}

inst-A → forward → inst-B
inst-B Response: "你好！收到了。请问有什么需要我帮忙处理的吗？"
Status: done=True, error=False
```

## Quick Start

### Download Release

Download the latest release from [Releases](https://github.com/chilishark27/ga-manager/releases):
- `ga_manager_backend.exe` — HTTP backend server (serves UI + API)
- `ga_manager_desktop.exe` — Native desktop window (WebView2)

### Run

1. Place both executables in the same directory as your GA project (or configure the path in Settings)
2. Start `ga_manager_backend.exe` — starts HTTP server on port 18600
3. Start `ga_manager_desktop.exe` — opens the native desktop window
4. Or just open `http://localhost:18600` in your browser

### Language Switch

Click the 🌐 button in the bottom-left corner of the sidebar to toggle between Chinese and English.

## Build from Source

### Prerequisites

- Go 1.21+
- Node.js 18+ & npm
- Windows (for desktop WebView2 build)

### Build Steps

```bash
# 1. Clone
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# 2. Build frontend
cd frontend
npm install
npx vite build --outDir ../build/static
cd ..

# 3. Build backend (embeds static files)
cd backend
go build -o ../build/ga_manager_backend.exe .
cd ..

# 4. Build desktop (optional, WebView2 wrapper)
cd desktop
go build -ldflags "-H windowsgui" -o ../build/ga_manager_desktop.exe .
cd ..
```

Output in `build/`:
- `ga_manager_backend.exe` (~7MB, includes embedded frontend)
- `ga_manager_desktop.exe` (~6.5MB, native desktop window)
- `static/` (frontend assets, served by backend)

## Project Structure

```
ga-manager/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/   # Sidebar, ChatPanel, RightPanel
│   │   ├── i18n/         # Internationalization (zh/en)
│   │   ├── store/        # Zustand state management
│   │   └── App.tsx
│   └── package.json
├── backend/           # Go HTTP server + API proxy
│   ├── handlers/      # REST API handlers
│   ├── services/      # Instance management, features
│   └── main.go
├── desktop/           # Go WebView2 wrapper
│   └── main.go
├── chilishark.png     # Project mascot
├── build/             # Build output
└── screenshots/
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/instances` | List all instances |
| POST | `/api/instances` | Create new instance |
| DELETE | `/api/instances/{id}` | Delete instance |
| POST | `/api/instances/{id}/chat` | Send message |
| POST | `/api/instances/{id}/config` | Set feature toggles |
| POST | `/api/instances/{id}/forward` | Forward message to another instance |
| GET | `/api/instances/{id}/sessions` | List session files |
| WS | `/api/instances/{id}/ws` | Real-time event stream |

## Configuration

On first launch, click ⚙️ in the right panel to configure:
- **GA Project Path** — Path to your GenericAgent installation
- **Python Path** — Python interpreter path

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Zustand, react-markdown
- **Backend**: Go, net/http, embed
- **Desktop**: Go, WebView2

## License

MIT
