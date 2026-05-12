# GA Manager — 详细技术设计

## 1. 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│  React 18 + Vite + Ant Design 5 (localhost:5173)            │
│  深色/浅色主题 · WebSocket实时流 · Markdown渲染             │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + WebSocket
┌──────────────────────────▼──────────────────────────────────┐
│  Go 后端 (localhost:18600)                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │InstanceMgr │ │ FileWatcher│ │ ServiceMgr │              │
│  │ (对话实例)  │ │ (output轮询)│ │(渠道/reflect)│              │
│  └────────────┘ └────────────┘ └────────────┘              │
└──────────────────────────┬──────────────────────────────────┘
                           │ subprocess + file IO
┌──────────────────────────▼──────────────────────────────────┐
│  GenericAgent (agentmain.py)                                 │
│  --task IODIR --llm_no N --nobg  (对话实例)                  │
│  --reflect reflect/xxx.py        (自主/定时/Goal/Team)       │
│  frontends/xxxapp.py             (IM渠道)                    │
└─────────────────────────────────────────────────────────────┘
```

## 2. 后端设计 (Go)

### 2.1 目录结构

```
backend/
├── main.go              # 入口: 路由注册, 启动watcher
├── go.mod
├── config/
│   └── config.go        # 配置: GA路径, 端口, 轮询间隔
├── handler/
│   ├── instance.go      # 对话实例 CRUD + 消息发送
│   ├── service.go       # 渠道/reflect 启停
│   ├── schedule.go      # 定时任务 CRUD
│   ├── config.go        # mykey.py 读写(脱敏)
│   ├── system.go        # 系统信息
│   └── ws.go            # WebSocket 连接管理
├── manager/
│   ├── instance.go      # 对话实例生命周期
│   ├── service.go       # 渠道/reflect进程管理(复用hub.pyw逻辑)
│   ├── watcher.go       # output.txt 文件轮询 + WS广播
│   └── scheduler.go     # 定时任务调度引擎
├── model/
│   └── types.go         # 所有数据结构
└── store/
    └── store.go         # 持久化(JSON文件, 不引入DB)
```

### 2.2 核心数据结构

```go
// 对话实例 - 通过 --task 模式与GA交互
type Instance struct {
    ID        string    `json:"id"`
    Name      string    `json:"name"`
    Status    string    `json:"status"`    // stopped|running|busy
    LLMNo     int       `json:"llm_no"`
    PID       int       `json:"pid"`
    IODir     string    `json:"io_dir"`    // temp/ga_inst_<id>
    CreatedAt time.Time `json:"created_at"`
    Uptime    string    `json:"uptime"`
    TokensUsed int64   `json:"tokens_used"`
}

// 服务(渠道/reflect) - 通过子进程管理
type Service struct {
    Name    string `json:"name"`     // "frontends/qqapp.py" 或 "reflect/autonomous.py"
    Type    string `json:"type"`     // "frontend" | "reflect"
    Status  string `json:"status"`   // "running" | "stopped"
    PID     int    `json:"pid"`
    Cmd     []string `json:"cmd"`
}

// 定时任务
type ScheduleTask struct {
    Name          string `json:"name"`           // 文件名(不含.json)
    Schedule      string `json:"schedule"`       // "HH:MM"
    Repeat        string `json:"repeat"`         // "daily"|"weekday"
    Enabled       bool   `json:"enabled"`
    MaxDelayHours int    `json:"max_delay_hours"`
    Prompt        string `json:"prompt"`
}
```

### 2.3 API 设计

```
=== 对话实例 ===
GET    /api/instances                 列出所有实例
POST   /api/instances                 创建 {name, llm_no}
DELETE /api/instances/:id             删除(停止+清理目录)
POST   /api/instances/:id/start      启动(写input.txt, 启子进程)
POST   /api/instances/:id/stop       停止(写_stop, 超时kill)
POST   /api/instances/:id/send       发消息 {content, images?}
                                     首轮→input.txt, 后续→reply.txt
POST   /api/instances/:id/abort      中止当前任务(写_stop)
GET    /api/instances/:id/history    获取对话历史

=== 渠道/Reflect 服务 ===
GET    /api/services                  列出所有可用服务
POST   /api/services/:name/start     启动服务
POST   /api/services/:name/stop      停止服务
GET    /api/services/:name/logs      获取日志(最近500行)

=== 定时任务 ===
GET    /api/schedules                 列出所有定时任务
POST   /api/schedules                 创建
PUT    /api/schedules/:name           修改
DELETE /api/schedules/:name           删除
POST   /api/schedules/:name/toggle   启用/禁用

=== 配置 ===
GET    /api/config/llm               获取LLM配置(脱敏)
POST   /api/config/llm               保存LLM配置
GET    /api/system                    系统信息(GA路径,Python版本等)

=== WebSocket ===
WS     /ws/instance/:id              实例输出实时流
WS     /ws/services                  服务状态变更通知
```

### 2.4 文件IO桥接逻辑

```
发送消息流程:
1. 用户发送 content → POST /api/instances/:id/send
2. 判断实例状态:
   - stopped → 写 input.txt, 启动子进程(--task --nobg), 记录PID
   - running(等待reply) → 写 reply.txt
   - busy(正在执行) → 返回错误"请等待当前任务完成"
3. Watcher 每200ms检查 output.txt 的 mtime+size
4. 有变化 → 读取新增内容 → 通过WS推送给前端
5. 检测到 "[ROUND END]" → 标记本轮完成, 状态改为 running(等待reply)
6. 10分钟无 reply → 进程自动退出, 状态改为 stopped

中止流程:
1. POST /api/instances/:id/abort
2. 写 _stop 文件到 IODir
3. 等待3s, 若进程未退出 → kill PID
4. 状态改为 stopped
```

### 2.5 服务发现

Go 后端启动时扫描 GA 目录:
- `frontends/*.py` → 过滤出 `*app.py` 作为渠道服务
- `reflect/*.py` → 过滤掉 `__*.py` 和 `goal_mode.py`(特殊处理)
- 排除: `chatapp_common.py`, `tuiapp.py`, `*_cmd.py`

## 3. 前端设计 (React + Ant Design)

### 3.1 目录结构

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
└── src/
    ├── App.tsx                  # 主布局(参考v9 Demo)
    ├── main.tsx
    ├── theme/
    │   ├── dark.ts             # Ant Design 深色token
    │   └── light.ts            # Ant Design 浅色token
    ├── pages/
    │   ├── Chat.tsx            # 主页: 左实例列表 + 右对话
    │   ├── Services.tsx        # 渠道/Reflect管理
    │   ├── Schedules.tsx       # 定时任务管理
    │   └── Settings.tsx        # LLM配置 + 系统信息
    ├── components/
    │   ├── InstanceList.tsx    # 左侧实例卡片列表
    │   ├── InstanceCard.tsx    # 单个实例卡片(状态灯+toggle)
    │   ├── ChatWindow.tsx      # 对话窗口(Markdown渲染)
    │   ├── MessageBubble.tsx   # 消息气泡
    │   ├── ServicePanel.tsx    # 服务开关面板
    │   ├── ScheduleEditor.tsx  # 定时任务编辑器
    │   └── TopBar.tsx          # 顶部操作栏
    ├── hooks/
    │   ├── useWebSocket.ts    # WS连接管理+自动重连
    │   └── useInstance.ts     # 实例状态管理
    ├── services/
    │   ├── api.ts             # REST API封装(axios)
    │   └── ws.ts              # WebSocket封装
    └── stores/
        └── appStore.ts        # Zustand全局状态
```

### 3.2 UI布局(基于v9 Demo确认)

```
┌─────────────────────────────────────────────────────────┐
│ [Logo] GA Manager    [Stats: 3运行 | 12K tok]  [🌙/☀️]  │ ← 顶部栏
├────────────┬────────────────────────────────────────────┤
│            │  [实例名] [运行中]  [▶Resume][⚡LLM][⏹停止] │ ← 操作栏
│  实例列表   │────────────────────────────────────────────│
│  ┌──────┐  │                                            │
│  │●主对话│  │  💬 用户: 帮我分析这段代码                  │
│  │ Web  │  │                                            │
│  │12K tok│  │  🤖 Agent: 好的，我来看看...               │
│  │[═══] │  │       ```python                           │
│  ├──────┤  │       def foo(): ...                      │
│  │●QQ   │  │       ```                                 │
│  │ IM   │  │                                            │
│  │[═══] │  │                                            │
│  ├──────┤  │────────────────────────────────────────────│
│  │○定时  │  │  [输入框...] [📎图片] [发送]               │ ← 输入区
│  │ Sche │  │  ┌─────────────────────────────┐          │
│  └──────┘  │  │ 🤖自主  📅定时  🎯Goal  👥Team│          │ ← 功能开关
│            │  └─────────────────────────────┘          │
│ [+ 新建]   │                                            │
└────────────┴────────────────────────────────────────────┘
```

### 3.3 关键交互

1. **实时流式输出**: WS推送 → 逐字追加到最后一条agent消息
2. **图片粘贴**: 监听paste事件 → 读取clipboard image → base64 → 随消息发送
3. **主题切换**: ConfigProvider token切换 + CSS变量切换
4. **实例切换**: 点击左侧卡片 → 切换WS订阅 → 加载该实例历史
5. **功能开关**: 每个实例独立的自主/定时/Goal/Team开关 → 对应启停reflect进程

### 3.4 消息格式

```typescript
interface Message {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;        // Markdown格式
  images?: string[];      // base64图片
  timestamp: number;
  status?: 'streaming' | 'done' | 'error';
}
```

## 4. 实现计划

### Phase 1: Go后端骨架 (核心)
1. 项目初始化 + 路由注册
2. Instance Manager: 创建/启停/发消息
3. File Watcher: output.txt轮询 + WS广播
4. Service Manager: 渠道/reflect启停

### Phase 2: React前端骨架
1. Vite + AntDesign + 路由 + 主题
2. Chat页: 实例列表 + 对话窗口
3. WebSocket集成 + 流式渲染

### Phase 3: 完善功能
1. 定时任务管理
2. LLM配置页
3. 图片粘贴上传
4. 服务日志查看

### Phase 4: 打磨
1. 错误处理 + 断线重连
2. 进程健康检查(自动重启)
3. 响应式布局
4. 打包部署脚本

## 5. mykey.py 配置向导模块

### 5.1 设计思路

GA 已有 `assets/configure_mykey.py`（999行CLI向导），定义了结构化的 `LLM_PROVIDERS` 和 `PLATFORMS` 数据。
UI 直接复用这些元数据，将CLI向导搬到Web界面。

### 5.2 后端实现

```go
// handler/config.go

// LLM厂商元数据(从configure_mykey.py的LLM_PROVIDERS提取，编译时内嵌JSON)
// 每个Provider包含:
type LLMProvider struct {
    ID           string            `json:"id"`           // "openai", "claude", "deepseek"...
    Name         string            `json:"name"`         // 显示名
    Desc         string            `json:"desc"`         // 一句话描述
    Type         string            `json:"type"`         // "oai" | "claude" | "mixin"
    Template     map[string]any    `json:"template"`     // 默认配置字段
    KeyHint      string            `json:"key_hint"`     // API Key获取提示
    ModelChoices []string          `json:"model_choices"`// 可选模型列表
    ExtraFields  []ExtraField      `json:"extra_fields"` // 额外配置项(apibase等)
}

type ExtraField struct {
    Key     string `json:"key"`
    Label   string `json:"label"`
    Default string `json:"default"`
}

// IM平台元数据
type Platform struct {
    ID      string     `json:"id"`       // "qq", "telegram", "dingtalk"...
    Name    string     `json:"name"`
    Desc    string     `json:"desc"`
    File    string     `json:"file"`     // "frontends/qqapp.py"
    EnvVars []EnvVar   `json:"env_vars"` // 需要配置的环境变量
}

type EnvVar struct {
    Key     string `json:"key"`
    Label   string `json:"label"`
    Hint    string `json:"hint"`
    Default string `json:"default"`
}
```

### 5.3 API

```
=== 配置向导 ===
GET    /api/config/providers          获取所有LLM厂商元数据
GET    /api/config/platforms           获取所有IM平台元数据
GET    /api/config/mykey              读取当前mykey.py(脱敏: key只显示前4+后4位)
POST   /api/config/mykey              保存mykey.py配置
POST   /api/config/mykey/validate     验证配置(尝试import)
GET    /api/config/mykey/raw          获取mykey.py原始源码(高级模式)
PUT    /api/config/mykey/raw          直接保存mykey.py源码(高级模式)
```

### 5.4 前端UI流程

```
Settings页面:
┌─────────────────────────────────────────────────────────────┐
│  LLM 配置                                    [高级模式 📝]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │ OpenAI  │ │ Claude  │ │DeepSeek │ │  通义   │  ...     │  ← 厂商卡片
│  │   ✓已配  │ │         │ │   ✓已配  │ │         │         │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                                                             │
│  ── 已配置的模型 ──────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ #0 DeepSeek-R1  apikey: sk-xx...xx  [编辑] [删除]     │ │
│  │ #1 GPT-4o       apikey: sk-xx...xx  [编辑] [删除]     │ │
│  │ #2 Mixin(故障转移) → DeepSeek → GPT-4o  [编辑]       │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│  ── IM 渠道配置 ──────────────────────────────────────────  │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ QQ机器人    APP_ID: [____]  APP_SECRET: [____] [保存] │ │
│  │ Telegram    BOT_TOKEN: [____]                  [保存] │ │
│  │ 企业微信    CORP_ID: [____]  SECRET: [____]    [保存] │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
│                              [💾 保存配置] [🔄 验证配置]     │
└─────────────────────────────────────────────────────────────┘

高级模式: Monaco Editor 直接编辑 mykey.py 源码
```

### 5.5 mykey.py 生成逻辑

```python
# Go后端生成mykey.py的模板逻辑(伪代码):
# 1. 根据用户选择的providers，按顺序生成变量:
#    - 单模型: native_oai_config_0 = {...}  → llm_no=0
#    - Mixin:  mixin_config = {...}         → llm_no=N
# 2. 变量命名规则决定Session类型:
#    - native_oai_config_*   → NativeOAISession (OpenAI兼容)
#    - native_claude_config_* → NativeClaudeSession
#    - mixin_config          → MixinSession (故障转移)
# 3. IM渠道凭证写入对应变量(qq_app_id, tg_bot_token等)
```

## 6. 图片处理

### 6.1 问题

`agentmain.py --task` 模式通过 `input.txt`/`reply.txt` 传递纯文本，不支持图片。
但 `put_task(query, source, images=None)` API层支持 images 参数。

### 6.2 方案: 文件约定协议

```
IO目录结构:
  temp/ga_inst_<id>/
  ├── input.txt          # 文本内容
  ├── input_images/      # 图片目录(新增约定)
  │   ├── 0.png
  │   └── 1.png
  ├── reply.txt
  ├── reply_images/      # 多轮图片
  ├── output.txt
  └── _stop

Go后端处理:
1. 用户粘贴图片 → 前端base64 → POST /api/instances/:id/send {content, images:[base64...]}
2. 后端将images写入 input_images/ 或 reply_images/
3. 需要修改agentmain.py的--task模式: 检查 *_images/ 目录，有则读取传给put_task

前端处理:
1. 监听 paste 事件 → 检测 clipboardData.items 中的 image/*
2. 转为 base64 → 显示预览缩略图
3. 随消息一起发送
```

### 6.3 GA侧改动(最小化)

```python
# agentmain.py --task 模式中，启动时检查图片:
# 在写入input.txt后、调用put_task前:
images = []
img_dir = os.path.join(io_dir, 'input_images')
if os.path.isdir(img_dir):
    for f in sorted(os.listdir(img_dir)):
        images.append(os.path.join(img_dir, f))
agent.put_task(query, 'task_file', images=images or None)
```

## 7. Agent协作(Team模式)

### 7.1 已有机制

GA 通过 `agent_team_worker.py` 实现 BBS 协作:
- 目录: `temp/bbs/` 下按话题分子目录
- 每个agent发帖/回帖，其他agent轮询读取
- 通过 `--reflect reflect/agent_team_worker.py` 启动

### 7.2 UI集成

```
Team模式在UI中的体现:
1. 每个实例的功能开关面板有 "👥 Team" 开关
2. 开启 → 后端启动该实例对应的 agent_team_worker.py reflect进程
3. 可查看 temp/bbs/ 下的协作消息(只读展示)
4. 不需要额外复杂逻辑，复用已有BBS机制
```

## 8. 进程健康检查

```go
// manager/health.go
// 每30s检查所有running实例和服务的进程是否存活
func (m *Manager) HealthCheck() {
    for _, inst := range m.instances {
        if inst.Status == "running" && !isProcessAlive(inst.PID) {
            inst.Status = "crashed"
            if m.config.AutoRestart {
                m.RestartInstance(inst.ID)
            }
            m.broadcast(Event{Type: "instance_crashed", ID: inst.ID})
        }
    }
}
```

## 9. 运行配置

```json
// ga_manager_config.json
{
  "ga_root": "D:\\python3_project\\GenericAgent",
  "port": 18600,
  "poll_interval_ms": 200,
  "max_instances": 10,
  "auto_restart": true,
  "default_llm_no": 0,
  "health_check_interval_s": 30
}
```

## 10. 启动方式

```bash
# 开发
cd backend && go run .
cd frontend && npm run dev

# 生产
cd frontend && npm run build   # 产物放 backend/static/
cd backend && go build -o ga_manager.exe
./ga_manager.exe               # 同时serve前端静态文件
```


## 11. Bridge 通信方案（核心架构）

### 11.1 设计思路

每个 GA 实例 = 一个独立 Python 子进程（`bridge.py`），启动时随机分配端口暴露 WebSocket。
Go 后端作为 Manager 负责启动/停止 bridge 进程、记录 PID+WS端口、中转或直连通信。

```
┌─────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  React 前端  │◄──WS──►│  Go Manager :18600│◄──WS──►│ bridge.py :rand  │
│  (AntDesign) │         │  (中转/注册表)     │         │ (import GA)      │
└─────────────┘         └──────────────────┘         └──────────────────┘
                                                       ↕ 进程内调用
                                                     ┌──────────────────┐
                                                     │ GeneraticAgent() │
                                                     │ put_task/abort   │
                                                     └──────────────────┘
```

### 11.2 可行性评估

| 维度 | 结论 | 依据 |
|------|------|------|
| 外部驱动GA | ✅ 已验证 | stapp.py 范例：`agent = GeneraticAgent()` → `agent.put_task(q)` → 迭代 deque 获取流式输出 |
| 进程隔离 | ✅ 无冲突 | 每个 bridge 独立进程，`script_dir`/`TOOLS_SCHEMA`/Session 等全局状态完全隔离 |
| 流式输出 | ✅ 原生支持 | `put_task()` 返回 deque，item 含 `{'next': chunk}` 或 `{'done': ...}`，天然适配 WS 推送 |
| 中止任务 | ✅ | `agent.abort()` 设置 `code_stop_signal` 停止执行中的代码 |
| 图片传递 | ✅ | `put_task(query, images=[...])` 直接支持，bridge 接收 base64 转传 |
| 多轮对话 | ✅ | 历史由 `client.backend.history`（Session）内部维护，连续调用 `put_task` 即可 |
| 模式切换 | ⚠️ 需包装 | reflect/goal/autonomous 通过 agent 属性设置，bridge 需暴露配置接口 |
| 不改GA源码 | ✅ | bridge.py 是独立文件，只 import + 调用公开 API |

### 11.3 bridge.py 核心设计

```python
import sys, asyncio, json, random, threading
sys.path.insert(0, GA_ROOT)
from agentmain import GeneraticAgent

agent = GeneraticAgent()
port = random.randint(20000, 60000)

# WS 消息协议
# → {"type":"chat",  "query":"...", "images":["base64..."]}
# → {"type":"abort"}
# → {"type":"config", "key":"autonomous", "value":true}
# → {"type":"status"}
# ← {"type":"chunk", "data":"..."}
# ← {"type":"done",  "exit_reason":{...}}
# ← {"type":"status","data":{"busy":bool,"uptime":int,"turns":int}}

async def handle(ws):
    async for msg in ws:
        data = json.loads(msg)
        if data['type'] == 'chat':
            dq = agent.put_task(data['query'], images=data.get('images'))
            # dq.get() 是阻塞的，需要在线程中运行
            def stream():
                while True:
                    item = dq.get()
                    if 'next' in item:
                        asyncio.run_coroutine_threadsafe(
                            ws.send(json.dumps({'type':'chunk','data':item['next']})), loop)
                    if 'done' in item:
                        asyncio.run_coroutine_threadsafe(
                            ws.send(json.dumps({'type':'done','exit_reason':item['done']})), loop)
                        break
            await asyncio.to_thread(stream)
        elif data['type'] == 'abort':
            agent.abort()
        elif data['type'] == 'config':
            setattr(agent, data['key'], data['value'])
            await ws.send(json.dumps({'type':'ack','key':data['key']}))
        elif data['type'] == 'status':
            await ws.send(json.dumps({'type':'status','data':{
                'busy': agent.busy, 'pid': os.getpid()
            }}))

loop = asyncio.new_event_loop()
# 启动后立即打印端口，供 Go Manager 通过 stdout 捕获
print(f"BRIDGE_PORT={port}", flush=True)
asyncio.run(websockets.serve(handle, '127.0.0.1', port))
```

### 11.4 Go Manager 端口管理

```go
// 启动 bridge 进程
cmd := exec.Command("python", "bridge.py", "--ga-root", gaRoot, "--llm-no", llmNo)
stdout, _ := cmd.StdoutPipe()
cmd.Start()

// 从 stdout 读取端口
scanner := bufio.NewScanner(stdout)
for scanner.Scan() {
    line := scanner.Text()
    if strings.HasPrefix(line, "BRIDGE_PORT=") {
        port, _ := strconv.Atoi(strings.TrimPrefix(line, "BRIDGE_PORT="))
        instance.Port = port
        instance.PID = cmd.Process.Pid
        break
    }
}
// 建立 WS 连接到 bridge
instance.WS = connectWS(fmt.Sprintf("ws://127.0.0.1:%d", port))
```

### 11.5 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| `dq.get()` 阻塞 | 异步事件循环卡死 | 用 `asyncio.to_thread` 包装阻塞调用 |
| 多实例共享 Chrome CDP | tab 冲突 | 每实例可配独立 `--user-data-dir`（高级功能，v2再做） |
| mykey.py 全局共享 | 所有实例用同一 key | bridge 启动参数 `--llm-no N` 选择不同模型槽位 |
| 内存占用 | 每进程 ~150MB | 限制 `max_instances`，前端显示内存用量 |
| bridge 进程崩溃 | 实例失联 | Manager 定期 health check（§8），自动重启 |
| 端口冲突 | 启动失败 | 随机端口 + 重试3次，失败则报错 |

### 11.6 与原 File IO 模式对比

| 维度 | File IO (--task) | Bridge (in-process) |
|------|-----------------|---------------------|
| 延迟 | 2s 轮询 | 实时流式 |
| 图片 | 不支持(需hack) | 原生支持 |
| 多轮 | reply.txt 手动续 | 自动维护 history |
| 模式切换 | 需重启进程 | 运行时动态设置 |
| 进程管理 | 简单(子进程) | 简单(子进程) |
| 复杂度 | 低 | 中(需写bridge.py) |

**结论：Bridge 方案全面优于 File IO，且复杂度可控。采用 Bridge 作为主方案。**
