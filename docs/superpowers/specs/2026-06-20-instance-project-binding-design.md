# 实例专属项目绑定

## 概述

每个 GA 实例可以绑定一个专属项目目录和 reflect 脚本，形成独立的"角色"。绑定后实例的 CWD 设为该目录，启动时自动将目录结构和关键文件内容注入 GA 的上下文。

## 数据模型变更

### 新增字段

所有涉及实例配置的结构体增加：

```go
ProjectDir    string `json:"project_dir,omitempty"`    // 专属项目目录路径
ReflectScript string `json:"reflect_script,omitempty"` // reflect 脚本路径（相对于 gaRoot/reflect/）
```

涉及文件：
- `backend/models/types.go` — `Instance` DTO、`CreateInstanceRequest`
- `backend/services/persistence.go` — `persistedInstance`
- `backend/services/instance.go` — `managedInstance`

### 向后兼容

两个字段都是 `omitempty`，不填则行为不变：
- `ProjectDir` 为空 → CWD = gaRoot（现有行为）
- `ReflectScript` 为空 → 不传 `--reflect`（现有行为）

## 启动行为变更

### CWD 设置

`instance.go` 的 `Create()` 中：

```go
workDir := gaRoot
if req.ProjectDir != "" {
    if _, err := os.Stat(req.ProjectDir); err == nil {
        workDir = req.ProjectDir
    }
}
cmd.Dir = workDir
```

### Reflect 脚本传参

```go
if req.ReflectScript != "" {
    reflectPath := filepath.Join(gaRoot, "reflect", req.ReflectScript)
    if _, err := os.Stat(reflectPath); err == nil {
        args = append(args, "--reflect", reflectPath)
    }
}
```

### 项目上下文注入

Bridge.py 增加 `--project-dir` 参数。当指定时，bridge 在 GA agent 初始化后、第一次用户对话前，自动注入一段系统上下文：

```python
def build_project_context(project_dir):
    """扫描项目目录，生成上下文摘要"""
    context = f"[项目上下文] 工作目录: {project_dir}\n\n"
    
    # 1. 目录结构（前3层，排除常见无用目录）
    tree = scan_tree(project_dir, max_depth=3, 
                     exclude=['node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build'])
    context += f"目录结构:\n{tree}\n\n"
    
    # 2. 关键文件内容
    key_files = ['README.md', 'README.rst', 'package.json', 'go.mod', 
                 'Cargo.toml', 'pyproject.toml', 'pom.xml', 'Makefile']
    for f in key_files:
        path = os.path.join(project_dir, f)
        if os.path.exists(path):
            content = read_file(path, max_chars=800)
            context += f"--- {f} ---\n{content}\n\n"
    
    # 3. 推断技术栈
    stack = detect_tech_stack(project_dir)
    if stack:
        context += f"技术栈: {', '.join(stack)}\n"
    
    return context
```

注入时机：bridge 的 `on_ready` 事件之后、首次 `send` 之前，调用 GA 的 `raw_ask` 或写入 memory 文件。

具体方式：将上下文写入 `{gaRoot}/temp/project_context_{instance_id}.md`，然后通过 bridge 告诉 GA 加载这个文件作为初始参考。

## 前端变更

### 创建实例对话框

新增两个字段：

```
┌─ 新建实例 ──────────────────────────────┐
│ 名称:    [my-assistant           ]      │
│ LLM:     [#2 Claude             ▾]      │
│ 项目目录: [/path/to/my/project   ] [📁] │
│ Reflect: [无 / goal_mode / hive_v2 ▾]   │
│                                          │
│                    [创建]                 │
└──────────────────────────────────────────┘
```

- **项目目录**：输入框 + 浏览按钮（Electron: `ipcRenderer.invoke('select-directory')`）
- **Reflect 下拉**：从 `GET /api/config/reflects` 获取可用列表（扫描 `{gaRoot}/reflect/*.py`）

### 实例信息展示

TopBar / 侧边栏实例卡片中，如果有 `project_dir`，显示项目名：

```
● my-assistant  running  [my-project]
```

### 实例配置修改

在实例右键菜单或设置面板中，可以修改 `project_dir` 和 `reflect_script`（修改后需重启实例生效）。

## 后端 API 变更

### 新增端点

```
GET /api/config/reflects  — 返回 {gaRoot}/reflect/ 下所有 .py 文件列表
```

响应：
```json
[
  {"file": "goal_mode.py", "name": "Goal Mode"},
  {"file": "hive_v2_worker.py", "name": "Hive v2 Worker"},
  {"file": "autonomous.py", "name": "Autonomous"}
]
```

### 修改端点

`POST /api/instances` — body 新增 `project_dir` 和 `reflect_script` 可选字段

`GET /api/instances/{id}` — 响应中包含 `project_dir` 和 `reflect_script`

## Bridge 变更

`bridge.py` 增加 CLI 参数：

```python
parser.add_argument('--project-dir', default='', help='Project working directory for context injection')
```

启动逻辑：
1. 如果 `--project-dir` 非空且目录存在
2. 调用 `build_project_context()` 生成上下文
3. 写入 `{ga_root}/temp/project_context.md`
4. 在 GA 首次 interact 时，prepend 这段上下文到用户消息（或作为系统提示注入）

## 实现范围

| 模块 | 变更 | 说明 |
|------|------|------|
| `models/types.go` | 改 | 加 ProjectDir, ReflectScript 字段 |
| `services/instance.go` | 改 | Create() 使用 project_dir 作为 CWD，传 --reflect |
| `services/persistence.go` | 改 | 持久化新字段 |
| `handlers/instance.go` | 改 | Create API 接收新字段 |
| `handlers/config.go` | 改 | 新增 GET /api/config/reflects |
| `bridge/bridge.py` | 改 | 接收 --project-dir，注入上下文 |
| `main.go` | 改 | 注册新路由 |
| 前端创建实例 | 改 | 新增项目目录 + reflect 选择 |
| 前端 TopBar/NavBar | 改 | 显示项目名 |
