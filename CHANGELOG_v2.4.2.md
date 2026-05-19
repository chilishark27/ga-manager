# GA Manager v2.4.2 — 体检报告与修复日记

## 体检报告

### 检查范围
- 前端 (React + TypeScript)
- 后端 (Go, 跨平台编译)
- Bridge (Python)
- Electron 打包配置
- 目标平台: Windows 10/11, macOS (Intel + Apple Silicon), Linux

---

### 发现的问题

| # | 严重度 | 问题 | 影响平台 | 位置 |
|---|--------|------|----------|------|
| 1 | 严重 | 发送消息到已停止实例报 "file already closed" 错误 | 全平台 | backend/services/instance.go |
| 2 | 严重 | 前端硬编码 `D:\python3_project\GenericAgent` 路径 | Linux/其他Windows用户 | NavBar.tsx, Sidebar.tsx, RightPanel.tsx |
| 3 | 高 | 侧栏 History 被 Instances 挤压为 0 高度不可见 | 小屏/多实例用户 | global.css |
| 4 | 高 | 进程树杀死在 Unix 上不可靠 (仅 pkill -P) | macOS/Linux | instance.go |
| 5 | 高 | Bridge 子进程在 macOS 上找不到 Python | macOS | instance.go |
| 6 | 高 | 计费数据重启后丢失 | 全平台 | 无持久化机制 |
| 7 | 中 | GA 路径检测缺少 Linux 常见目录 | Linux | main.go |
| 8 | 中 | Python 检测不够全面 (缺 conda/MacPorts) | macOS/Linux | main.go |
| 9 | 中 | Setup 页面无配置验证，用户不知道配置是否正确 | 全平台 | SetupPage.tsx |
| 10 | 中 | Setup 页面只有中文 | 非中文用户 | SetupPage.tsx |
| 11 | 低 | 侧栏默认 90px 太窄，内容挤在一起 | 全平台 | global.css |
| 12 | 低 | Features 区域不可折叠，占用固定空间 | 小屏用户 | NavBar.tsx |

---

## 修复日记

### 2024-05-19 修复记录

#### 1. Bridge stdin 写入错误 (严重)

**根因**: 实例停止后 `stdin` pipe 已关闭但未置 nil，后续写入触发 Go 的 "write to closed pipe" 错误。`waitForExit` 也未清理 stdin 引用。

**修复**:
- `SendCommand()` 增加状态检查，stopped/error 状态直接返回清晰错误
- `Stop()` 关闭 stdin 后立即置 nil
- `waitForExit()` 进程退出时置 nil
- 错误信息从 "failed to write to bridge stdin: write |1: file already closed" 改为 "instance is not running (state: stopped)"

#### 2. 硬编码路径清除 (严重)

**根因**: 开发时使用本机路径作为默认值，其他用户/平台看到无意义的路径。

**修复**:
- 所有 `D:\python3_project\GenericAgent`、`C:\GenericAgent`、`/Users/Shared/GenericAgent` 全部移除
- 默认值改为空字符串，依赖后端自动检测或用户手动输入
- Placeholder 改为描述性文字: "GenericAgent 项目路径" / "Path to GenericAgent"
- 涉及文件: NavBar.tsx, Sidebar.tsx, RightPanel.tsx, SetupPage.tsx

#### 3. 侧栏布局修复 (高)

**根因**: `.nav-sessions` 使用 `flex: 1` + 父容器 `overflow: hidden`，当 Instances 数量多时 History 被挤压为 0。

**修复**:
- 侧栏改为 `overflow-y: auto`（整体可滚动）
- History 列表: `max-height: 35vh`（基于视口高度自适应）
- Instances 列表: `max-height: 30vh; overflow-y: auto`
- 侧栏默认宽度 90px → 180px
- 添加 `@media (max-height: 700px)` 响应式规则

#### 4. Unix 进程树杀死 (高)

**根因**: `killProcessTree` 仅用 `pkill -P` 杀直接子进程，不可靠。

**修复**:
- `proc_other.go`: 启动时设置 `Setpgid: true` 创建进程组
- `killProcessTree`: Unix 上使用 `syscall.Kill(-pid, SIGKILL)` 杀整个进程组
- Windows 保持 `taskkill /F /T`
- 添加 `killPgid()` 平台分离函数

#### 5. macOS PATH 注入 (高)

**根因**: Electron GUI 应用不继承 shell PATH，bridge 子进程找不到 Python 和工具。

**修复**:
- 新增 `buildBridgeEnv()` 函数，统一为所有 bridge 子进程构建环境变量
- macOS/Linux 注入: `/opt/homebrew/bin`, `/usr/local/bin`, `~/.pyenv/shims`, `~/.local/bin`, `~/miniconda3/bin`
- 三处 `cmd.Env` 赋值统一调用此函数

#### 6. 计费数据持久化 (高)

**根因**: token/cost 数据仅存内存，重启即丢失。

**修复**:
- 新增 `cost_persistence.go`: 保存/加载 `~/.ga-manager/costs.json`
- 保存时机: 实例停止、进程异常退出、应用关闭
- 恢复时机: 启动时 `RestoreInstances()` 加载
- 保存内容: input/output/cache tokens, total_turns, 最近 20 条 history
- `RestoreInstances` 同时初始化 `tokenStats`（修复 nil pointer 风险）

#### 7. GA 路径检测扩展 (中)

**修复**: 添加 Linux 常见目录 `~/src/`, `~/git/`, `~/.local/share/`

#### 8. Python 检测增强 (中)

**修复**: 添加 `/opt/local/bin/python3` (MacPorts), `~/miniconda3/bin/python3`, `~/anaconda3/bin/python3`

#### 9. Setup 页面验证 (中)

**修复**:
- 新增 `POST /api/config/validate` 端点
- 检查: GA 路径是否包含 agentmain.py、Python 是否可用（返回版本号）、Bridge 是否存在
- 前端显示 ✓/✗ 验证结果

#### 10. Setup 页面 i18n (中)

**修复**: 所有文案支持中英文切换

#### 11. 侧栏宽度 (低)

**修复**: 默认 180px，可拖拽 160-320px，响应式断点适配

#### 12. Features 可折叠 (低)

**修复**: 点击 "Features" 标题可折叠/展开，与 History 交互一致

---

## 编译验证

| 平台 | 架构 | 结果 |
|------|------|------|
| Windows | AMD64 | ✅ 通过 |
| macOS | ARM64 (Apple Silicon) | ✅ 通过 |
| macOS | AMD64 (Intel) | ✅ 通过 |
| Linux | AMD64 | ✅ 通过 |
| Frontend | TypeScript + Vite | ✅ 通过 |

---

## 遗留事项

1. macOS Electron 仅打包 ARM64 二进制，Intel Mac 需通过 Rosetta 2 运行
2. Linux 仅打包 AMD64，ARM64 Linux 用户需自行编译
3. GitHub Dependabot 报告 2 个中等级别依赖漏洞（electron 相关）
