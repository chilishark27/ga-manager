<p align="center">
  <img src="chilishark.png" width="200" alt="ChiliShark" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  <strong>多实例 GenericAgent 管理面板</strong><br/>
  创建、监控、编排 AI Agent 实例，深色主题桌面应用。
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> •
  <a href="https://github.com/chilishark27/GenericAgent">GenericAgent</a> •
  <a href="#快速开始">快速开始</a>
</p>

---

## 界面预览

<p align="center">
  <img src="screenshots/desktop_main.png" width="800" alt="GA Manager 桌面应用" />
</p>

<p align="center">
  <img src="screenshots/demo_chat.png" width="800" alt="与 Agent 对话" />
</p>

---

## 功能一览

| 功能 | 说明 |
|------|------|
| 🖥️ **实例管理** | 同时创建、删除、排序、监控多个 GA 实例 |
| 💬 **实时对话** | 流式响应 + Markdown 实时渲染 + 状态指示器 |
| 🎯 **目标模式** | 设置持久目标，引导 Agent 在所有交互中围绕目标工作 |
| 🤝 **同伴提示** | 注入系统级提示词，塑造 Agent 回复风格 |
| 🔄 **反思模式** | Agent 每次回复后自动反思总结 |
| 🤖 **自主模式** | Agent 进入自驱循环，无需用户输入持续工作 |
| 📨 **消息转发** | 实例间消息路由，实现多 Agent 协作 |
| ⏰ **定时任务** | 为任意实例设置 cron 定时任务 |
| 📋 **SOP 浏览器** | 浏览和查看所有可用的标准操作流程 |
| 💻 **系统资源** | 实时监控 CPU、内存、磁盘使用率 |
| 🌐 **多语言** | 中文 / 英文界面一键切换 |

---

## 功能演示

### 🎯 目标模式

设置持久目标后，Agent 在每次交互中都会参考该目标来组织回复。

```
POST /api/instances/{id}/chat
Body: {"message": "监控CPU温度，超过80°C时发出警报"}

# 设置目标为 "系统监控专家" 后：
# → Agent 回复聚焦于系统监控领域的专业方案
```

**验证结果**：Agent 生成了完整的监控脚本，与设定目标高度一致。

---

### 🤝 同伴提示

注入不可见的系统指令，改变 Agent 的回复方式。

```
POST /api/instances/{id}/chat
Body: {"message": "解释 Docker 网络原理"}

# 设置 peer_hint = "请用简洁专业的语气回复，优先给出代码示例"：
# → Agent 以代码开头，文字说明精简
```

**验证结果**：回复风格明显变化 — 更少文字，更多代码块。

---

### 🔄 反思模式

每次回复后，Agent 自动追加 `<summary>` 反思标签，分析自身输出质量。

```
Agent 回复：
"这是监控脚本..."

<summary>提供了基于 psutil 的 CPU 监控方案，含邮件告警。
可改进：增加 GPU 温度支持。</summary>
```

**验证结果**：每条回复末尾都包含自我评估摘要。

---

### 🤖 自主模式

Agent 进入自驱循环，自动执行任务，无需等待用户输入。

```
# 开启自主模式 → 发送初始任务 → Agent 自动继续
POST /api/instances/{id}/chat
Body: {"message": "创建测试文件并验证它们存在"}

# Agent 自主执行：
# 1. 创建文件
# 2. 验证存在性
# 3. 报告完成
```

**验证结果**：Agent 自动创建了 `test_auto.txt` 并确认其存在，全程无需额外提示。

---

### 📨 消息转发

将消息从一个实例路由到另一个实例，实现多 Agent 协作。

```
POST /api/instances/{id}/forward
Body: {"target_id": "实例B的ID", "message": "请审查这段代码"}

# 实例 B 收到: "[From instance a1b2c3d4] 请审查这段代码"
# 实例 B 独立处理并回复
```

**验证结果**：实例 B 成功收到转发消息，处理后回复 "你好！收到了，有什么可以帮你的？"

---

## 快速开始

### 下载

从 [Releases](https://github.com/chilishark27/ga-manager/releases) 下载最新版本，或从源码构建。

### 前置条件

- 已安装 [GenericAgent](https://github.com/chilishark27/GenericAgent)
- Python 3.10+
- Windows 10/11

### 运行

1. 启动 `ga_manager.exe`
2. 点击 ⚙️ 配置：
   - **GA 项目路径** — GenericAgent 安装目录
   - **Python 路径** — Python 解释器路径
3. 点击 **+ 新建实例** 创建 Agent
4. 开始对话！

---

## 从源码构建

```bash
# 克隆
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# 前端
cd frontend
npm install
npx vite build --outDir ../build/static
cd ..

# 后端（内嵌静态文件）
cd backend
go build -o ../build/ga_manager_backend.exe .
cd ..

# 桌面包装器（可选）
cd desktop
go build -o ../build/ga_manager.exe .
cd ..
```

### 构建依赖

- Go 1.21+
- Node.js 18+ & npm

---

## API 参考

| 方法 | 端点 | 说明 |
|------|------|------|
| `GET` | `/api/instances` | 列出所有实例 |
| `POST` | `/api/instances` | 创建实例 |
| `DELETE` | `/api/instances/{id}` | 删除实例 |
| `POST` | `/api/instances/{id}/chat` | 发送消息 |
| `POST` | `/api/instances/{id}/new_session` | 新建对话 |
| `POST` | `/api/instances/{id}/forward` | 转发到其他实例 |
| `GET` | `/api/instances/{id}/sessions` | 列出会话文件 |
| `GET` | `/api/instances/{id}/sessions/{file}` | 获取会话内容 |
| `GET` | `/api/sop/list` | 列出可用 SOP |
| `GET` | `/api/sop/content?name=X` | 读取 SOP 内容 |
| `GET` | `/api/system/resources` | 系统资源统计 |
| `WS` | `/api/instances/{id}/ws` | 实时事件流 |

---

## 架构

```
┌─────────────────────────────────────────────┐
│           桌面端 (WebView2)                  │
├─────────────────────────────────────────────┤
│       前端 (React + TypeScript)              │
├─────────────────────────────────────────────┤
│         后端 (Go HTTP + WebSocket)           │
├─────────────────────────────────────────────┤
│    GenericAgent (Python) × N 个实例          │
└─────────────────────────────────────────────┘
```

---

## 语言切换

点击侧边栏的 🌐 按钮即可在中文和英文之间切换。

## 许可证

MIT
