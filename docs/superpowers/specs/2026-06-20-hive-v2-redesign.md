# Hive v2 重新设计 — 任务图 + GA↔Claude Code 协作

## 概述

全面重新设计 Hive 模式，解决当前架构的三大核心问题：
1. 任务执行后无法追溯，跨 Session 失忆
2. 无法查看产出文件
3. 可观测性和交互性差

新架构以 **Task Graph（任务图）** 为核心，用 **MCP 协议** 桥接 GA Agent 和 Claude Code，实现"GA 做调研/设计，Claude Code 做实现/验证"的协作模式。

## 设计原则（继承自 GA Goal Hive Master）

- **四阶段循环**：Detect → Design → Execute → Verify，每轮迭代遵循此范式
- **Budget-driven completion**：到预算交付当前最优版本，不死等完美
- **Anchor-based iteration**：锚定当前最优交付物，每轮只做增量改进
- **结构化任务 > 消息流**：任务是一等公民，不是消息帖子

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   GA Manager (Go Backend)                 │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Task Engine   │  │ Context Store│  │ File Tracker   │  │
│  │ (DAG 调度)    │  │ (文件存储)    │  │ (fsnotify)    │  │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                  │                   │          │
│  ┌──────┴──────────────────┴───────────────────┴───────┐ │
│  │              Hive MCP Server (:9600)                  │ │
│  │  Tools: task/update, context/write, artifact/register │ │
│  │  Resources: hive://context, hive://tasks, hive://...  │ │
│  └──────┬────────────────────────────────┬─────────────┘ │
└─────────┼────────────────────────────────┼───────────────┘
          │                                │
    ┌─────▼─────┐                   ┌──────▼──────┐
    │ GA Agents  │                   │ Claude Code  │
    │ (调研/设计) │                   │ (实现/验证)   │
    │ via Bridge │                   │ via MCP      │
    └───────────┘                   └─────────────┘
```

## 模块设计

### 1. Task Engine（任务引擎）

取代 BBS 消息板，作为任务分发和协调中心。

#### 任务节点结构

```json
{
  "id": "task_001",
  "type": "research | design | implement | verify",
  "title": "调研主流支付SDK方案",
  "status": "pending | running | done | failed | blocked | stalled",
  "executor": "ga | claude_code | human",
  "depends_on": [],
  "inputs": {
    "context_refs": ["支付SDK对比结论"]
  },
  "outputs": {
    "context_keys": ["支付SDK对比结论"],
    "files": ["artifacts/payment_comparison.md"]
  },
  "assigned_to": "Worker-Alpha",
  "started_at": "2026-06-20T14:00:00Z",
  "finished_at": "2026-06-20T14:28:00Z",
  "budget_minutes": 30,
  "log_file": "logs/task_001_调研支付SDK.log"
}
```

#### 调度规则

| 任务类型 | 默认执行者 | 说明 |
|---------|-----------|------|
| research | GA Agent | 信息收集、对比分析 |
| design | GA Agent | 方案设计、架构决策 |
| implement | Claude Code | 代码实现、文件操作 |
| verify | Claude Code | 测试运行、结果验证 |

- 依赖全部 `done` 后自动变为 `pending` 可调度
- 超时（budget 耗尽）标记为 `stalled`，通知用户
- 用户可手动重新分配执行者

#### 任务拆解流程

1. 用户输入高层目标
2. 自动创建第一个任务：type=`design`，title="拆解目标为子任务"
3. GA Agent 分析后产出子任务列表，写回 Task Engine
4. Task Engine 构建 DAG，按依赖关系调度
5. 默认套用四阶段模板：Detect(research) → Design(design) → Execute(implement) → Verify(verify)

### 2. Context Store（共享记忆层）

解决"失忆"问题的核心。GA 调研结论写入这里，Claude Code 实现时读取这里。

#### 条目结构

每个 context 条目是一个 Markdown 文件，附带 YAML frontmatter：

```markdown
---
key: 支付SDK对比结论
type: finding
source_task: task_001
tags: [payment, research]
created_at: 2026-06-20T14:30:00Z
---

# 支付 SDK 对比结论

经过调研，Stripe / 支付宝 / 微信支付三者对比如下...
```

#### 索引文件 `_index.json`

```json
[
  {
    "key": "支付SDK对比结论",
    "file": "支付SDK对比结论.md",
    "type": "finding",
    "source_task": "task_001",
    "tags": ["payment", "research"],
    "created_at": "2026-06-20T14:30:00Z"
  }
]
```

#### Context 类型

| type | 用途 |
|------|------|
| finding | 调研发现、事实信息 |
| decision | 设计决策、方案选择 |
| summary | 阶段总结、进度汇报 |
| requirement | 用户需求、约束条件 |

### 3. File Tracker（文件追踪器）

监控 workspace 目录变更，实时关联到任务节点。

#### 行为

- 使用 fsnotify 监控 `artifacts/` 目录
- 文件创建/修改时，关联到当前 running 状态的任务
- 记录文件变更历史：谁（哪个任务）在什么时候创建/修改了什么文件
- 前端实时显示文件列表变更

#### 文件变更记录

```json
{
  "file": "artifacts/payment_service.py",
  "action": "created",
  "task_id": "task_003",
  "timestamp": "2026-06-20T15:10:00Z",
  "size_bytes": 2048
}
```

### 4. Hive MCP Server

GA Manager 暴露 MCP 协议接口，供 Claude Code 连接。

#### Tools（Claude Code 可调用）

| Tool | 参数 | 用途 |
|------|------|------|
| `hive_task_list` | `status?`, `type?` | 查看任务列表 |
| `hive_task_claim` | `task_id` | 领取一个待执行任务 |
| `hive_task_update` | `task_id`, `status`, `summary?` | 更新任务状态 |
| `hive_context_read` | `key` | 读取指定 context 条目 |
| `hive_context_write` | `key`, `type`, `content`, `tags?` | 写入新 context 条目 |
| `hive_artifact_register` | `task_id`, `file_path`, `description` | 注册产出文件 |
| `hive_project_summary` | — | 获取项目全局状态摘要 |

#### Resources（Claude Code 可读取）

| URI | 内容 |
|-----|------|
| `hive://project/summary` | 项目目标 + 当前进度 |
| `hive://context/{key}` | 指定 context 条目内容 |
| `hive://tasks/pending` | 待执行任务列表 |
| `hive://tasks/all` | 全部任务状态 |
| `hive://artifacts/list` | 产出文件清单 |

#### Claude Code 连接方式

用户在 Claude Code 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "ga-hive": {
      "command": "npx",
      "args": ["-y", "ga-hive-mcp-client"],
      "env": {
        "HIVE_URL": "http://localhost:9600",
        "HIVE_PROJECT": "proj_20260620_支付系统接入"
      }
    }
  }
}
```

或者 GA Manager 直接提供 stdio MCP server 可执行文件，Claude Code 连接即用。

### 5. GA Agent 适配

#### Worker 新工作循环

取代旧的"BBS 轮询接单"模式：

```
Worker 循环：
1. GET /internal/tasks/next?executor=ga&type=research,design
   → 领取一个 pending 任务
2. 读取任务的 inputs.context_refs
   → 获取前序任务产出的上下文
3. 执行调研/设计（通过 GA reflect 机制）
4. POST /internal/context/write
   → 产出写入 Context Store
5. POST /internal/tasks/{id}/complete
   → 标记完成 + 关联产出
6. 回到 1
```

#### 新 Reflect 脚本：`hive_v2_worker.py`

替代 `agent_team_worker.py`，核心区别：
- 不再轮询 BBS，改为轮询 Task Engine
- 领取到任务后，prompt 中包含结构化的任务描述 + context 引用
- 执行完成后通过 API 回报，不是发帖

#### Master 角色变化

旧 Master 通过 BBS 帖子协调，新设计中：
- **Task Engine 本身就是 Master**——调度逻辑在 Go 后端
- 可选保留一个 GA Agent 做"目标拆解"（第一个 design 任务）
- 四阶段循环由 Task Engine 自动驱动，不需要 Agent 来协调

### 6. 前端重新设计

#### 项目列表页（替代 Start 表单）

```
┌────────────────────────────────────────────────┐
│  Hive 项目                          [+ 新建]    │
├────────────────────────────────────────────────┤
│  🔄 支付系统接入     4/6 任务完成   35min        │
│  ✅ 用户调研报告     6/6 任务完成   1h 20min     │
│  ✅ API 文档生成     3/3 任务完成   15min        │
└────────────────────────────────────────────────┘
```

- 进行中项目可以"继续"（跨 Session 接续）
- 历史项目可以查看完整执行记录
- 新建时输入目标 + 选择 LLM + 时间预算

#### 项目执行页（三栏布局）

```
┌────────────────────────────────────────────────────────┐
│  支付系统接入  [进行中]  4/6 ✅  ⏱ 35min   [停止]      │
├──────────┬─────────────────────────┬───────────────────┤
│ 任务图    │      任务详情            │   产出文件        │
│          │                         │                   │
│ ✅ 调研   │  标题: Stripe API 接入   │ 📄 payment.py    │
│ ✅ 设计   │  执行者: Claude Code     │ 📄 test.py       │
│ 🔄 实现← │  状态: running (12min)   │ 📄 config.yaml   │
│ ⏳ 测试   │                         │                   │
│          │  ── 执行日志 ──          │  [预览]           │
│          │  > 读取设计方案...        │  [打开目录]       │
│          │  > 创建 payment.py...    │                   │
│          │  > 写入测试文件...        │                   │
│          │                         │                   │
├──────────┴─────────────────────────┴───────────────────┤
│ Context: 调研结论(2) | 设计决策(1) | 总结(0)             │
└────────────────────────────────────────────────────────┘
```

#### 关键交互改进

| 旧问题 | 新方案 |
|--------|--------|
| 消息流自动滚底无法回看 | 任务列表静态，点选查看详情 |
| 不知道产出文件在哪 | 右侧文件面板实时更新，可预览 |
| 执行完失忆 | 项目持久化，随时回看 |
| Checklist 无作用 | 任务列表本身就是 checklist |
| 看不到 Agent 具体操作 | 每个任务有独立执行日志 |

#### 文件预览

- Markdown：渲染预览
- 代码：语法高亮
- 图片：直接展示
- 其他：显示文件信息 + 打开按钮

## 存储结构

```
{gaRoot}/hive_projects/
└── {日期}_{项目名称}/
    ├── project.json
    ├── tasks/
    │   ├── 01_research_支付SDK调研.json
    │   ├── 02_design_支付模块架构.json
    │   ├── 03_implement_stripe接入.json
    │   └── 04_verify_集成测试.json
    ├── context/
    │   ├── 支付SDK对比结论.md
    │   ├── 架构决策_选用Stripe.md
    │   └── _index.json
    ├── artifacts/
    │   ├── payment_service.py
    │   └── test_payment.py
    └── logs/
        ├── 01_research_支付SDK调研.log
        ├── 02_design_支付模块架构.log
        └── 03_implement_stripe接入.log
```

所有文件名语义化，人直接打开目录就能看懂全貌。

## project.json 结构

```json
{
  "id": "proj_20260620_支付系统接入",
  "name": "支付系统接入",
  "objective": "调研主流支付SDK并接入Stripe",
  "status": "running",
  "created_at": "2026-06-20T14:00:00Z",
  "updated_at": "2026-06-20T15:10:00Z",
  "budget_minutes": 60,
  "elapsed_minutes": 35,
  "executor_config": {
    "ga_llm_no": 2,
    "ga_workers": 2,
    "claude_code_enabled": true
  },
  "task_count": { "total": 6, "done": 4, "running": 1, "pending": 1 }
}
```

## 完整工作流示例

```
用户输入: "调研主流支付SDK并接入Stripe"

1. [Task Engine] 创建项目 + 首个 design 任务 "拆解目标"
2. [GA Agent] 领取拆解任务 → 产出子任务列表
3. [Task Engine] 构建 DAG:
     01_research_支付SDK调研
     02_design_架构设计 (depends: 01)
     03_implement_stripe接入 (depends: 02)
     04_verify_集成测试 (depends: 03)
4. [GA Agent] 领取 01 → 调研 → 写入 context/支付SDK对比结论.md
5. [GA Agent] 领取 02 → 读取调研结论 → 写入 context/架构决策.md
6. [Claude Code via MCP] 领取 03 → 读取设计方案 → 实现代码 → 注册 artifacts
7. [Claude Code via MCP] 领取 04 → 跑测试 → 报告结果
8. [Task Engine] 全部 done → 项目标记完成

全程：前端实时显示进度，文件面板实时更新，Context 可随时查阅
```

## 异常处理

| 场景 | 处理 |
|------|------|
| GA Worker 崩溃 | 任务保持 running，超时后标记 stalled，可重新分配 |
| Claude Code 断开 | 同上 |
| 任务执行失败 | 标记 failed + 记录错误，不阻塞无依赖任务 |
| Budget 到期 | 交付当前最优版本，running 任务标记 stalled |
| 用户中断 | 保存当前状态，下次可继续 |

## 废弃内容

| 废弃 | 替代 |
|------|------|
| BBS 消息板 (agent_bbs.py) | Task Engine + Context Store |
| agent_team_worker.py | hive_v2_worker.py (结构化任务领取) |
| goal_mode.py 作为 Master | Task Engine 内置调度逻辑 |
| checklist_master.py | 任务列表本身就是 checklist |
| Checklist 前端模式选择 | 统一为 Task Graph 视角 |


## 双向触发机制

GA 调研完成后自动通知 Claude Code 开始实现，无需人工介入。

#### 触发链设计

```
Task done (GA) → Task Engine 检查后继任务 → 后继 executor=claude_code?
  → Yes: 推送通知到 Claude Code MCP 连接
  → No (executor=ga): 直接分配给下一个 GA Worker
```

#### 实现方式

| 方向 | 机制 | 说明 |
|------|------|------|
| GA → Claude Code | MCP Server-Sent Notification | Task Engine 检测到 implement 任务就绪时，通过 MCP notification 推送 |
| Claude Code → GA | HTTP callback | Claude Code 完成实现后调用 `task_update_status`，Engine 自动解锁下游 GA 任务 |
| 用户介入点 | 可配置 gate | 某些任务节点标记 `requires_approval: true`，需用户确认才继续 |

#### 通知协议

MCP Server 向已连接的 Claude Code 客户端发送 notification：

```json
{
  "method": "notifications/task_ready",
  "params": {
    "task_id": "03_implement_stripe接入",
    "title": "Stripe API 接入实现",
    "context_refs": ["支付SDK对比结论", "架构决策_选用Stripe"],
    "priority": "normal"
  }
}
```

Claude Code 收到后可自动开始工作，或提示用户确认。

#### 自动化程度可配置

```json
// project.json 中
{
  "automation": {
    "auto_dispatch_ga": true,
    "auto_dispatch_claude": true,
    "require_approval_before_implement": false,
    "require_approval_before_verify": false
  }
}
```

- 全自动：调研完自动设计，设计完自动实现，实现完自动测试
- 半自动：每个阶段切换时暂停，等用户确认
- 手动：所有任务需人工触发

## 任务模板库

预置常见工作流 DAG 模板，新建项目时可选择模板快速启动。

#### 内置模板

| 模板名 | 阶段 | 适用场景 |
|--------|------|---------|
| 调研报告 | research × N → summarize → output | 多方向并行调研 + 汇总 |
| 代码重构 | analyze → design → implement → verify | 理解现有代码 → 重构实现 |
| 项目吸收 (Morphling) | decompose → evaluate × N → implement × N → integrate | 拆解目标项目各组件 |
| SOP 执行 | parse_sop → execute_steps × N → verify | 按步骤执行流程 |
| Bug 修复 | reproduce → diagnose → fix → regression_test | 定位问题 → 修复 → 验证 |
| 功能开发 | research → design → implement → test → document | 完整功能开发流程 |

#### 模板文件格式

存储在 `{gaRoot}/hive_templates/` 目录下：

```yaml
# hive_templates/调研报告.yaml
name: 调研报告
description: 多方向并行调研 + 汇总成报告
variables:
  - name: topic
    label: 调研主题
    required: true
  - name: directions
    label: 调研方向（逗号分隔）
    required: true
  - name: output_format
    label: 输出格式
    default: markdown

tasks:
  - id: "{i}_research_{direction}"
    type: research
    title: "调研: {direction}"
    executor: ga
    for_each: directions  # 对每个方向生成一个并行任务

  - id: "summarize"
    type: design
    title: "汇总调研结论"
    executor: ga
    depends_on: ["*_research_*"]  # 等所有调研完成

  - id: "output"
    type: implement
    title: "生成最终报告"
    executor: claude_code
    depends_on: ["summarize"]
```

#### 用户自定义模板

- 用户可以将任何完成的项目"保存为模板"
- 前端提供模板编辑器（YAML 编辑 + DAG 可视化预览）
- 模板中的变量在新建项目时填写

## 多项目并行

支持同时运行多个 Hive 项目，各项目独立调度互不干扰。

#### 资源管理

```json
// ga_manager_config.json 新增
{
  "hive": {
    "max_concurrent_projects": 3,
    "max_ga_workers_total": 5,
    "max_claude_sessions_total": 2,
    "worker_pool": {
      "shared": true  // 多项目共享 worker pool vs 各项目独占
    }
  }
}
```

#### 调度策略

- **Worker Pool 模式**：所有 GA Worker 放入公共池，按任务优先级领取（跨项目）
- **项目优先级**：用户可手动设置项目优先级（high / normal / low）
- **资源竞争**：当 worker 不够时，高优先级项目的任务优先分配
- **Claude Code 会话**：每个 implement/verify 任务独立 session，可并行

#### 前端展示

项目列表页显示所有运行中项目的实时状态：

```
┌────────────────────────────────────────────────────────┐
│  Hive 项目                                    [+ 新建]  │
├────────────────────────────────────────────────────────┤
│  🔄 支付系统接入    ██████░░ 4/6  ⏱ 35min  ⚡ high     │
│  🔄 用户文档生成    ███░░░░░ 2/5  ⏱ 12min  ● normal   │
│  ⏸ API 性能优化    █░░░░░░░ 1/8  ⏱ 5min   ○ paused   │
├────────────────────────────────────────────────────────┤
│  资源: GA Workers 3/5 | Claude Code 1/2                 │
└────────────────────────────────────────────────────────┘
```

- 点击项目进入三栏执行页
- 可暂停/恢复项目（释放 worker 给其他项目）
- 全局资源用量一目了然

## Webhook 通知

项目状态变更时推送通知到外部服务。

#### 支持的事件

| 事件 | 触发时机 |
|------|---------|
| `project.created` | 新建项目 |
| `project.completed` | 全部任务完成 |
| `project.failed` | 项目失败（关键任务 failed） |
| `task.completed` | 单个任务完成 |
| `task.failed` | 单个任务失败 |
| `artifact.created` | 新产出文件 |
| `budget.warning` | Budget 即将耗尽（剩余 20%） |
| `budget.expired` | Budget 到期 |

#### Webhook 配置

```json
// project.json 或全局配置
{
  "webhooks": [
    {
      "url": "https://hooks.slack.com/services/xxx",
      "events": ["project.completed", "task.failed"],
      "format": "slack"
    },
    {
      "url": "http://localhost:8080/hive-callback",
      "events": ["*"],
      "format": "json"
    }
  ]
}
```

#### Payload 格式

```json
{
  "event": "task.completed",
  "timestamp": "2026-06-20T15:10:00Z",
  "project": {
    "id": "proj_20260620_支付系统接入",
    "name": "支付系统接入"
  },
  "data": {
    "task_id": "03_implement_stripe接入",
    "title": "Stripe API 接入实现",
    "executor": "claude_code",
    "duration_minutes": 12,
    "artifacts": ["payment_service.py", "test_payment.py"]
  }
}
```

#### 内置通知渠道

除了 Webhook URL，还支持直接集成：
- **系统通知**：GA Manager 桌面通知（Electron notification）
- **飞书/企微/钉钉**：复用 Channels 页面已配置的 IM 通道
- **邮件**：可配置 SMTP 发送邮件通知

## 实现范围（更新）

| 模块 | 工作量 | 说明 |
|------|--------|------|
| Task Engine (Go) | 新增 | DAG 调度 + 文件存储 + 内部 API |
| Context Store (Go) | 新增 | Markdown + JSON 索引读写 |
| File Tracker (Go) | 新增 | fsnotify 监控 + 变更记录 |
| Hive MCP Server | 新增 | MCP 协议实现，供 Claude Code 连接 |
| 双向触发 + 通知 | 新增 | Task Engine 内置事件驱动 + MCP notification |
| 任务模板库 | 新增 | YAML 模板解析 + 模板编辑 UI |
| 多项目调度 | 新增 | Worker Pool + 优先级调度 |
| Webhook 系统 | 新增 | 事件发布 + HTTP 推送 + IM 集成 |
| hive_v2_worker.py | 新增 | GA Worker 新 reflect 脚本 |
| HivePage.tsx | 重写 | 项目列表 + 三栏执行页 + 模板选择 |
| hive.go handler | 重写 | 新 API endpoints |
| 旧 BBS / Checklist | 删除 | 不再需要 |
