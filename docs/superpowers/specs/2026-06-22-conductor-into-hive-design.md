# Conductor 融入 Hive — 子 Agent 作为 Worker

## 概述

将 Conductor 的子 Agent 编排能力融入 Hive 模式。Hive 启动时不再单独 spawn 独立的 `agentmain.py` Worker 进程，而是通过 Conductor 机制创建子 Agent 作为 Worker，它们通过 BBS 协作。

## 动机

当前 Hive 的 Worker 是独立进程（`agentmain.py --reflect agent_team_worker.py`），存在问题：
- 进程管理不稳定（崩溃后无法自动恢复）
- 无法动态增减 Worker
- Worker 状态不可见（只能看系统日志）
- 与 Conductor 的子 Agent 功能重复

## 设计

### 核心思路

Hive 的 Coordinator + Workers 全部由 Conductor 子 Agent 承担：
- 一个子 Agent 角色为 **Coordinator**（负责拆分任务、验收、总结）
- N 个子 Agent 角色为 **Worker**（接单、执行、汇报）
- 所有子 Agent 通过 BBS 通信（保留现有 BBS 机制）

### 架构变更

```
旧：
  Hive Start → spawn BBS → spawn N 个 agentmain.py 进程 → 各自轮询 BBS

新：
  Hive Start → spawn BBS → 通过 Conductor API 创建 N+1 个子 Agent
                          → 每个子 Agent 的 prompt 包含 BBS 接入信息
                          → Coordinator 子 Agent 负责拆分和验收
                          → Worker 子 Agent 接单执行
```

### 子 Agent 创建方式

使用现有 `POST /api/conductor/subagents` API：

**Coordinator Agent:**
```json
{
  "prompt": "[Coordinator] 目标: {objective}\nBBS: {url} Key: {key}\n你负责拆分任务并指派给 Worker，验收结果后发 [最终总结]",
  "name": "Hive-Coordinator"
}
```

**Worker Agent (×N):**
```json
{
  "prompt": "[Worker-Alpha] BBS: {url} Key: {key}\n你是 Hive Worker，在 BBS 上接单执行。看到 [指派: Worker-Alpha] 的任务就执行。",
  "name": "Hive-Worker-Alpha"
}
```

### 优势

- **可见性**：每个子 Agent 的对话历史可在 Conductor 面板查看
- **稳定性**：Conductor 管理子 Agent 生命周期，崩溃可重启
- **动态调度**：运行中可以追加/删除 Worker 子 Agent
- **统一管理**：不再有游离的 Python 进程
- **讨论能力**：子 Agent 被持续唤醒，自然能看到 BBS 上其他人的帖子并回应

### Hive 页面变更

- 启动后不再显示"系统日志"（没有独立进程了）
- 改为显示"子 Agent 状态"面板（列出每个子 Agent 的名称、状态、最后活动时间）
- 点击某个子 Agent 可以跳转到 Conductor 查看其详细对话

### API 变更

**Hive Start 流程改为：**
1. 启动 BBS（保留）
2. 调用 Conductor API 创建 Coordinator 子 Agent
3. 调用 Conductor API 创建 N 个 Worker 子 Agent
4. 子 Agent 自动开始工作（Conductor 机制）

**Hive Stop 流程改为：**
1. 保存进度（保留）
2. 通过 Conductor API 删除所有 Hive 相关子 Agent
3. 停止 BBS（保留）

### 依赖

- Conductor handler 已有：创建/删除/查询子 Agent 的完整 API
- BBS 机制保留不变
- 需要 Conductor 在后台运行（Hive Start 时自动启动 Conductor）

### 兼容性

- 保留旧的 Worker 进程模式作为 fallback（如果 Conductor 未启动）
- 新模式默认启用，用户可在模式选择中选 "Hive (子Agent)" 或 "Hive (进程)"

## 实现范围

| 模块 | 变更 |
|------|------|
| `backend/handlers/hive.go` | Start/Stop 改为调用 Conductor API 创建子 Agent |
| `backend/handlers/conductor.go` | 可能需要内部调用接口（不走 HTTP） |
| `frontend/src/pages/HivePage.tsx` | 右侧面板从"系统日志"改为"子 Agent 状态" |
| 模式选择 | 新增 "Hive (子Agent)" 选项 |
