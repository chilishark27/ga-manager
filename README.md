# 🦈 GA Manager

<p align="center">
  <img src="chilishark.png" width="120" alt="ChiliShark Logo">
</p>

<p align="center">
  <b>多实例 GenericAgent 管理面板</b><br>
  一键启动、实时对话、图片识别、配置管理、IM渠道绑定
</p>

<p align="center">
  <a href="#功能特性">功能</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#架构">架构</a> •
  <a href="#截图">截图</a> •
  <a href="https://github.com/lsdefine/GenericAgent">GenericAgent</a>
</p>

---

## 关于

GA Manager 是 [GenericAgent](https://github.com/lsdefine/GenericAgent) 的图形化管理工具，提供 Web 和桌面两种使用方式。无需修改 GA 源码，通过 Bridge 机制实现多实例并行管理。

## 功能特性

| 功能 | 说明 |
|------|------|
| 🚀 多实例管理 | 创建/启动/停止/删除多个 GA 实例 |
| 💬 实时对话 | WebSocket 实时通信，支持 Markdown 渲染 |
| 🖼️ 图片识别 | 粘贴图片发送，自动调用 Vision API 分析 |
| 🔄 模式切换 | chat / goal / auto / plan 四种运行模式 |
| 🤖 LLM 切换 | 运行时动态切换模型（Claude/GPT/Gemini等） |
| 🔌 IM 渠道 | QQ / Telegram / 微信 / 钉钉 / 飞书 / Discord |
| ⚙️ 功能开关 | 自主行动、反思模式、定时任务一键切换 |
| 📊 系统监控 | CPU / 内存 / 磁盘实时监控 |
| 📦 SOP 市场 | 从 [SophHub](https://fudankw.cn/sophub/) 浏览下载 SOP |
| 🌗 主题切换 | 深色 / 浅色主题 |
| 🖥️ 桌面应用 | Windows 桌面版 + 系统托盘 |

## 架构

```
┌─────────────┐     WS/HTTP      ┌──────────────┐    WS     ┌─────────────┐
│  React UI   │ ◄──────────────► │  Go Backend  │ ◄───────► │  Bridge.py  │
│  (Vite+TS)  │    :3000→:18600  │  (net/http)  │  随机端口  │  (per inst) │
└─────────────┘                  └──────────────┘           └──────┬──────┘
                                                                   │ import
                                                            ┌──────▼──────┐
                                                            │ GenericAgent│
                                                            │  (不修改)   │
                                                            └─────────────┘
```

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 18 + TypeScript + Zustand | 深色/浅色主题，响应式布局 |
| 后端 | Go 1.21+ (net/http + gorilla/websocket) | 零框架，标准库路由 |
| 桥接 | Python (asyncio + websockets) | 每实例独立进程，直接 import GA |

## 快速开始

### 前置条件

- [GenericAgent](https://github.com/lsdefine/GenericAgent) 已克隆到本地
- Go 1.21+
- Node.js 18+
- Python 3.10+（GA 运行环境）

### 安装

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager
```

### 开发模式

```bash
# Windows 一键启动
start_dev.bat

# 或手动：
# 后端
cd backend && go build -o ga_manager.exe . && ga_manager.exe

# 前端
cd frontend && npm install && npm run dev
```

访问 http://localhost:18600

### 桌面版

从 [Releases](https://github.com/chilishark27/ga-manager/releases) 下载预编译版本，双击运行即可。

## 目录结构

```
ga-manager/
├── backend/         # Go 后端服务
│   ├── main.go
│   ├── handlers/    # HTTP/WS 路由处理
│   ├── services/    # 业务逻辑
│   └── models/      # 数据结构
├── bridge/          # Python 桥接层
│   └── bridge.py   # GA 实例 wrapper
├── desktop/         # 桌面版入口
│   └── main.go     # systray + Edge --app
├── frontend/        # React 前端
│   ├── src/
│   │   ├── components/
│   │   ├── store/
│   │   ├── styles/
│   │   └── types/
│   └── package.json
├── start_dev.bat    # 开发启动脚本
├── DESIGN.md        # 设计文档
└── PLAN.md          # 规划文档
```

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | /api/instances | 列出所有实例 |
| POST | /api/instances | 创建实例 |
| DELETE | /api/instances/:id | 删除实例 |
| POST | /api/instances/:id/stop | 停止实例 |
| POST | /api/instances/:id/chat | 发送消息 |
| POST | /api/instances/:id/clear | 清空对话 |
| GET | /ws/:id | WebSocket 对话通道 |
| GET | /api/llm | 获取可用 LLM 列表 |
| GET | /api/config/mykey | 获取 mykey 配置 |
| PUT | /api/config/mykey | 更新 mykey 配置 |
| GET | /api/resources | 系统资源监控 |

## 致谢

- [GenericAgent](https://github.com/lsdefine/GenericAgent) - 核心 Agent 框架
- [genericagent-launcher](https://github.com/dhdbv-cbs/genericagent-launcher) - 参考实现

## License

MIT
