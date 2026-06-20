"""
Hive v2 Worker — reflect script for GenericAgent
Polls the Hive v2 Task Engine for pending tasks and executes them.

Usage: agentmain.py --reflect reflect/hive_v2_worker.py --base_url http://localhost:PORT

Replaces agent_team_worker.py (BBS-based). This version:
- Polls structured tasks from Task Engine API
- Receives task context (previous findings/decisions) as part of prompt
- Reports results back via API (context write + task complete)
"""

import json
import os
import time
from urllib import request, error

INTERVAL = 15  # Poll every 15 seconds
ONCE = False

_base_url = ""
_project_id = ""
_current_task = None

def init(a):
    """Called once with agent config dict. Extract Hive v2 connection info."""
    global _base_url, _project_id
    _base_url = a.get("base_url", os.environ.get("HIVE_URL", "http://127.0.0.1:12100"))
    _project_id = a.get("project_id", os.environ.get("HIVE_PROJECT", ""))

    # Strip trailing slash
    _base_url = _base_url.rstrip("/")


def check():
    """Called every INTERVAL seconds. Return prompt string or None to skip."""
    global _current_task

    if not _base_url or not _project_id:
        return "/exit"

    # If we have a current task that's running, don't pick up a new one
    if _current_task and _current_task.get("status") == "running":
        return None

    # Poll for next available task
    task = _fetch_next_task()
    if not task:
        return None

    # Claim the task
    if not _claim_task(task["id"]):
        return None

    _current_task = task

    # Fetch context references
    context_content = _fetch_context(task)

    # Build prompt
    return _build_prompt(task, context_content)


def _fetch_next_task():
    """Get next pending task for GA executor."""
    url = f"{_base_url}/api/hive2/projects/{_project_id}/tasks/next?executor=ga"
    try:
        req = request.Request(url)
        resp = request.urlopen(req, timeout=10)
        data = json.loads(resp.read())
        if data and data.get("id"):
            return data
    except Exception:
        pass
    return None


def _claim_task(task_id):
    """Claim a task for this worker."""
    url = f"{_base_url}/api/hive2/projects/{_project_id}/tasks/{task_id}/claim"
    try:
        body = json.dumps({"assignee": f"GA-Worker-{os.getpid()}"}).encode()
        req = request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        resp = request.urlopen(req, timeout=10)
        return resp.status == 200
    except Exception:
        return False


def _fetch_context(task):
    """Fetch context entries referenced by the task's inputs."""
    context_refs = task.get("inputs", {}).get("context_refs", [])
    if not context_refs:
        return ""

    parts = []
    for key in context_refs:
        url = f"{_base_url}/api/hive2/projects/{_project_id}/context/{key}"
        try:
            req = request.Request(url)
            resp = request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            if data and data.get("content"):
                parts.append(f"## {key}\n\n{data['content']}")
        except Exception:
            parts.append(f"## {key}\n\n(failed to load)")

    return "\n\n---\n\n".join(parts)


def _build_prompt(task, context_content):
    """Build the prompt for the GA agent."""
    task_type_labels = {
        "research": "调研任务",
        "design": "设计任务",
        "implement": "实现任务",
        "verify": "验证任务",
    }

    type_label = task_type_labels.get(task.get("type", ""), "任务")

    prompt_parts = [
        f"[Hive v2 {type_label}]",
        f"",
        f"## 任务: {task['title']}",
        f"- 类型: {task.get('type', 'unknown')}",
        f"- ID: {task['id']}",
    ]

    if task.get("budget_minutes"):
        prompt_parts.append(f"- 时间预算: {task['budget_minutes']}分钟")

    if context_content:
        prompt_parts.extend([
            "",
            "## 前序成果（已完成任务的产出）",
            "",
            context_content,
        ])

    # Add instructions based on task type
    prompt_parts.extend(["", "## 执行要求", ""])

    if task.get("type") == "research":
        prompt_parts.extend([
            "1. 围绕任务标题进行全面调研",
            "2. 收集关键事实、数据、对比信息",
            "3. 形成结构化结论",
            "4. 调研完成后，将结论保存为文件",
            "",
            "调研结论将作为后续设计和实现的依据，请确保信息准确完整。",
        ])
    elif task.get("type") == "design":
        prompt_parts.extend([
            "1. 基于调研结论进行方案设计",
            "2. 明确技术选型、架构决策",
            "3. 输出设计方案文档",
            "4. 如果是任务拆解，输出子任务列表（JSON格式）",
            "",
            "设计方案将指导后续实现，请确保方案清晰可执行。",
        ])
    elif task.get("type") == "implement":
        prompt_parts.extend([
            "1. 按照设计方案进行代码实现",
            "2. 确保代码质量和测试覆盖",
            "3. 将产出文件放在工作目录中",
        ])
    elif task.get("type") == "verify":
        prompt_parts.extend([
            "1. 验证实现是否满足设计要求",
            "2. 运行测试，检查边界情况",
            "3. 输出验证报告",
        ])

    prompt_parts.extend([
        "",
        "## 完成后",
        "",
        f"任务完成后，调用以下API报告结果:",
        f"",
        f"1. 写入 Context（如有产出结论）:",
        f"   POST {_base_url}/api/hive2/projects/{_project_id}/context",
        f'   Body: {{"key": "<结论标题>", "type": "finding|decision|summary", "content": "<内容>", "source_task": "{task["id"]}", "tags": [...]}}',
        f"",
        f"2. 标记任务完成:",
        f"   POST {_base_url}/api/hive2/projects/{_project_id}/tasks/{task['id']}/complete",
        f'   Body: {{"summary": "<简要总结>", "outputs": {{"context_keys": ["<写入的key>"], "files": []}}}}',
        f"",
        f"如果任务失败:",
        f"   POST {_base_url}/api/hive2/projects/{_project_id}/tasks/{task['id']}/fail",
        f'   Body: {{"error": "<失败原因>"}}',
    ])

    return "\n".join(prompt_parts)
