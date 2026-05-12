# GenericAgent 管理面板 — 设计方案

## 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 前端 | React 18 + Vite + Ant Design 5 | SPA，WebSocket实时通信 |
| 后端 | Go (Gin + gorilla/websocket) | 管理GA子进程，文件IO桥接 |
| 通信 | REST API + WebSocket | REST管理实例，WS推送实时输出 |

## 核心架构

```
┌─────────────────────────────────────────────────────┐
│  React + Ant Design 前端 (localhost:5173)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ 实例面板  │ │ 对话窗口  │ │ 配置页面  │            │
│  └──────────┘ └──────────┘ └──────────┘            │
└────────────────────┬────────────────────────────────┘
                     │ HTTP + WebSocket
┌────────────────────▼────────────────────────────────┐
│  Go 后端 (localhost:18600)                           │
│  ┌─────────────────────────────────────────────┐    │
│  │ Instance Manager                             │    │
│  │  - 创建/销毁 GA 子进程                        │    │
│  │  - 文件IO轮询 (output.txt 变化)              │    │
│  │  - WebSocket 广播输出                         │    │
│  └─────────────────────────────────────────────┘    │
└────────────────────┬────────────────────────────────┘
                     │ subprocess + file IO
┌────────────────────▼────────────────────────────────┐
│  agentmain.py --task <IODIR> --llm_no N --nobg      │
│  每个实例一个独立子进程 + 独立 temp/<id>/ 目录        │
│  协议: input.txt → output.txt → reply.txt → loop    │
└─────────────────────────────────────────────────────┘
```

## 文件IO协议（GA已有，Go直接复用）

| 文件 | 方向 | 作用 |
|---|---|---|
| `input.txt` | Go→GA | 首次任务输入 |
| `output.txt` | GA→Go | 实时输出（GA概率性写入中间结果） |
| `reply.txt` | Go→GA | 多轮对话追加输入 |
| `_stop` | Go→GA | 中止信号 |
| `_history.json` | Go→GA | 恢复历史上下文 |
| `stdout.log` | GA→Go | 进程标准输出日志 |

## 功能模块

### 1. 实例管理（Dashboard 首页）
- 实例卡片列表：显示名称、状态(stopped/running/busy)、LLM型号、创建时间
- 一键创建：选择LLM、命名、立即启动
- 批量操作：全部停止、清理已停止实例
- 状态指示灯：绿色running、黄色busy、灰色stopped

### 2. 对话界面（Chat 页）
- 左侧实例列表 + 右侧聊天窗口（类似IM布局）
- Markdown渲染输出（代码高亮）
- 实时流式显示（Go轮询output.txt变化，通过WS推送diff）
- 中止按钮、清空历史
- 支持图片上传（base64传入）

### 3. 配置管理（Config 页）
- mykey.py 在线编辑器（Monaco Editor）
- API Key脱敏显示，编辑时明文
- 配置模板一键复制
- mixin_config可视化编辑（LLM优先级拖拽排序）
- 保存前自动备份

### 4. 系统监控（Monitor 页）
- 各实例CPU/内存占用
- 日志查看（stdout.log/stderr.log）
- GA根目录信息

## API 设计

```
GET    /api/instances            - 列出所有实例
POST   /api/instances            - 创建实例 {name, llm_no}
POST   /api/instances/:id/start  - 启动
POST   /api/instances/:id/stop   - 停止(写_stop + kill)
DELETE /api/instances/:id        - 删除
POST   /api/instances/:id/task   - 发送任务 {query, images}
POST   /api/instances/:id/reply  - 多轮追加 {content}
POST   /api/instances/:id/abort  - 中止当前任务
GET    /api/instances/:id/messages - 获取历史消息
GET    /api/instances/:id/logs   - 获取日志

GET    /api/config               - 获取配置(脱敏)
POST   /api/config               - 保存配置
GET    /api/config/template      - 获取模板
GET    /api/system               - 系统信息

WS     /ws/:id                   - 实时输出流
```

## 前端目录结构

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── App.tsx                 # 路由 + Layout
    ├── main.tsx                # 入口
    ├── pages/
    │   ├── Dashboard.tsx       # 首页：实例卡片 + 快速创建
    │   ├── Chat.tsx            # 对话页：左列表右聊天
    │   ├── Config.tsx          # 配置管理
    │   └── Monitor.tsx         # 系统监控
    ├── components/
    │   ├── InstanceCard.tsx    # 实例卡片组件
    │   ├── ChatWindow.tsx      # 聊天窗口
    │   ├── MessageBubble.tsx   # 消息气泡(支持MD)
    │   ├── CreateModal.tsx     # 创建实例弹窗
    │   └── ConfigEditor.tsx    # 配置编辑器
    ├── services/
    │   ├── api.ts              # REST API封装
    │   └── ws.ts               # WebSocket管理
    └── stores/
        └── instanceStore.ts    # Zustand状态管理
```

## Go后端目录结构

```
backend/
├── main.go                 # 入口，路由注册
├── go.mod
├── go.sum
├── handler/
│   ├── instance.go         # 实例CRUD + 启停
│   ├── task.go             # 任务发送/中止
│   ├── config.go           # 配置读写
│   └── ws.go               # WebSocket处理
├── manager/
│   ├── instance.go         # 实例生命周期管理
│   └── watcher.go          # 文件变化监控(轮询output.txt)
└── model/
    └── types.go            # 数据结构定义
```

## 关键实现细节

1. **文件轮询策略**：Go每200ms检查output.txt的mtime和size，有变化时读取新增内容通过WS推送
2. **多轮对话**：第一轮写input.txt启动进程，后续轮次写reply.txt（GA会等待该文件出现）
3. **进程管理**：Go持有每个子进程的PID，stop时先写`_stop`文件优雅停止，超时3s后kill
4. **实例隔离**：每个实例使用独立目录 `temp/ga_inst_<id>/`，互不干扰
5. **断线重连**：前端WS断开后自动重连，重连后从messages API拉取完整历史
6. **增量输出**：Go记录上次读取的output.txt偏移量，只推送新增部分给前端

## 开发步骤

1. Go后端骨架 — 路由、实例管理器、文件IO桥接
2. 前端脚手架 — Vite + AntDesign + 路由 + 状态管理
3. Dashboard页 — 实例列表、创建/启停
4. Chat页 — WebSocket对话、流式输出
5. Config页 — 配置编辑器
6. 联调测试 — 启动真实GA实例验证全流程
