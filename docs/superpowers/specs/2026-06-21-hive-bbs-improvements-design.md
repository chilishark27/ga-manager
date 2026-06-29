# Hive BBS 模式改进设计

## 核心问题

当前 BBS 模式的劣势阻碍了专业使用：轮询浪费、延迟高、单会话、prompt 约束无法强制执行。

## 改进方案

### 1. 事件驱动替代轮询（最大改善）

**问题：** Worker 每 10s 轮询一次，空转浪费 + 响应慢。

**方案：** BBS 加一个 long-poll `/wait` 端点 — Worker 挂起等待新帖，有帖子立刻返回。

```python
# agent_bbs.py 新增
@app.get("/wait")
async def wait_for_post(since_id: int = 0, timeout: int = 60):
    """Block until a new post arrives or timeout. Zero-cost when idle."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        posts = get_posts_since(since_id)
        if posts:
            return posts
        await asyncio.sleep(0.5)  # 内部轮询 0.5s，但 HTTP 连接只有一个
    return []  # timeout, no new posts
```

Worker reflect 的 `check()` 改为调 `/wait?since_id=X&timeout=55`：
- 无新帖时阻塞最多 55 秒（不唤醒 agent，零 token 消耗）
- 有新帖时立即返回，Worker 在 1 秒内响应
- INTERVAL 设为 60（匹配 timeout），实际响应延迟 < 1 秒

**效果：** 
- 空转 token 消耗从"每 10 秒唤醒一次"降为"0"
- 响应延迟从最慢 10 秒降为 < 1 秒

### 2. 多会话支持

**方案：** HiveHandler 管理 `map[string]*HiveSession`。

- 每个 session 独立端口、独立 BBS、独立 Workers
- 前端 Hive 页顶部加 tab 栏：每个 session 一个 tab
- API 加 `?sid=xxx` 参数区分

可以同时跑"调研竞品"和"审计代码"两个任务。

### 3. 代码级约束（不靠 prompt）

| 约束 | 当前（prompt） | 改进（代码强制） |
|------|--------------|----------------|
| 目录限制 | prompt 说"禁止访问" | Worker CWD 已设为项目目录 ✓，但 agent 仍能 `cd ..`。可加 chroot 或 path filter |
| 禁止 push | prompt 说"禁止 git push" | 在项目目录加 `.git/hooks/pre-push` 脚本，exit 1 阻止 |
| 帖子长度 | prompt 说"不超过 3000 字" | BBS 端加 content length limit，超过截断并提示 |

**最简实现：** Hive 启动时自动在项目目录写一个 `pre-push` hook：
```bash
#!/bin/sh
echo "Push blocked by Hive. Only Coordinator can push."
exit 1
```
停止时删除。

### 4. 场景预设（一键启动专业配置）

不同场景用不同的 Coordinator prompt + Worker 数 + 时间预算：

| 场景 | Workers | Plan | 特点 |
|------|---------|------|------|
| 🔍 代码审计 | 3 | ✓ | 安全+架构+性能三视角 |
| 📊 市场调研 | 3 | ✓ | 行业+竞品+用户三方向 |
| 🛠️ 功能开发 | 2 | ✓ | 设计+实现，串行依赖 |
| 🐛 Bug 修复 | 1 | ✗ | 单 Worker 快速定位修复 |
| 📝 文档撰写 | 2 | ✗ | 调研+撰写 |

前端：启动表单顶部一排场景卡片，点击自动填充配置。

### 5. 进度聚合 + 实时状态

**后端新增 `GET /api/hive/dashboard`：** 解析所有帖子返回结构化状态

```json
{
  "phase": "executing",  // planning | assigning | executing | reviewing | done
  "progress": { "total": 3, "claimed": 2, "done": 1, "verified": 0 },
  "workers": [
    { "name": "Worker-Alpha", "role": "安全审计师", "status": "busy", "progress": "2/4", "plan": "1.扫描依赖 2.检查认证..." },
    { "name": "Worker-Beta", "role": "架构分析师", "status": "done", "progress": "3/3" }
  ],
  "elapsed_minutes": 12,
  "estimated_remaining": 8
}
```

前端不再自己解析帖子 — 直接用后端返回的结构化数据渲染。

## 实现优先级

1. **事件驱动（/wait 端点）** — 解决最大痛点（空转 + 延迟），改动集中在 BBS + reflect 脚本
2. **git hook 强制** — 5 行代码，效果立竿见影
3. **场景预设** — 读 yaml + 前端 UI
4. **Dashboard API** — 后端解析帖子返回结构化数据
5. **多会话** — 架构重构，最后做
