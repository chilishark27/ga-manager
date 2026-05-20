<p align="center">
  <img src="frontend/public/app.png" width="120" alt="GA Manager" />
</p>

<h1 align="center">GA Manager</h1>

<p align="center">
  <strong>多实例 GenericAgent 桌面管理器</strong><br/>
  创建、监控、编排 AI Agent 实例，现代化桌面 UI。
</p>

<p align="center">
  <a href="README.md">English</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#功能列表">功能列表</a> •
  <a href="#使用指南">使用指南</a> •
  <a href="#从源码构建">构建</a>
</p>

---

## 快速开始

1. 从 [Releases](https://github.com/chilishark27/ga-manager/releases) 下载
2. 安装：
   - **Windows**: 运行 `GA-Manager-X.X.X-x64.exe` — 一键静默安装
   - **macOS**: 打开 `.dmg`，拖入 Applications。首次启动：右键 → "打开"
   - **Linux**: `chmod +x GA-Manager-*.AppImage && ./GA-Manager-*.AppImage`
3. 首次启动会进入配置引导，设置 GA 项目路径
4. 点击"验证配置"确认环境正确，然后"开始使用"

**前置条件：**
- 已安装 [GenericAgent](https://github.com/lsdefine/GenericAgent)
- Python 3.10+（python 或 python3 在 PATH 中，或手动配置完整路径）
- GenericAgent 目录下已配置 `mykey.py`

---

## 功能列表

| 功能 | 说明 |
|------|------|
| **聊天** | 与 Agent 实时对话，Markdown 渲染，图片粘贴，会话历史 |
| **编排** | 多 Agent 编排协作 - 创建子 Agent，协调复杂任务 |
| **蜂巢** | 多 Agent 目标协作，通过 BBS 消息板分工合作 |
| **吸收** | Morphling 项目能力吸收/替代，通过蜂巢执行 |
| **监控** | Token 费用追踪，系统资源（CPU/内存） |
| **技能** | 技能树可视化 + SOP 文件编辑器 |
| **待办** | 悬浮任务卡片 - 手动添加、自动识别、一键执行 |
| **回溯** | 对话时间线导航，分支 Fork，多时间线切换 |
| **更新** | 检测新版本，下载，静默安装 |

---

## 使用指南

### 1. 初始配置

首次启动进入配置引导：
- **GA 项目路径**：GenericAgent 目录（包含 agentmain.py）
- **Python 路径**（可选）：留空自动检测，或填写完整可执行文件路径
- 点击 **验证配置** 检查：GA 路径、Python、Bridge
- 点击 **开始使用** 保存

重新配置：设置页面 -> 重新配置 按钮

### 2. 创建实例

1. 点击侧栏底部 **+ 新建实例**
2. 输入实例名称（可选）
3. GA Root 自动从配置读取
4. 选择 LLM 模型（从 mykey.py 读取）
5. 点击创建，实例自动启动

### 3. 聊天

- 输入消息按 Enter 发送
- Ctrl+V 粘贴图片
- 侧栏 History 点击恢复会话
- 双击会话重命名
- 搜索框搜索历史会话
- Review 按钮进行代码审查

### 4. 功能开关

| 开关 | 作用 |
|------|------|
| **自主行动** | 30分钟无操作后 Agent 自动执行任务 |
| **反思** | 每次行动后自我检查 |
| **定时任务** | cron 表达式定时执行 |
| **开发模式** | 注入开发最佳实践到系统提示词 |

### 5. 编排模式

创建多个子 Agent 并行工作，由 Conductor 统一调度。

1. 进入编排页面
2. 点击启动编排（自动安装依赖）
3. 在聊天面板输入任务
4. Conductor 分析并分配给子 Agent
5. 点击子 Agent 卡片查看输出

适合：可拆分的复杂任务。端口自动检测。

### 6. 蜂巢模式

多个 Worker 通过 BBS 消息板协作。

1. 进入蜂巢页面
2. 输入目标
3. 设置时间和 Worker 数量
4. 点击启动蜂巢
5. 观察 Worker 协作过程

适合：调研、信息收集、多角度分析。

### 7. Morphling 能力吸收

给定目标项目，通过蜂巢多 Agent 协作完成能力吸收/替代。

1. 进入 **吸收** 页面
2. 输入目标项目（GitHub URL / 项目名 / 产品描述）
3. 选择模式：
   - **调用型**：把目标能力纳入自身工具链
   - **重写型**：理解核心后从零实现更好版本
   - **混合型**：按组件决定调用/重写/舍弃
4. 可选填写测例和已知组件
5. 设置时间预算和 Worker 数量
6. 点击启动，自动通过蜂巢执行

适合：分析竞品、吸收开源能力、构建替代方案。

### 8. 回溯模式（Rewind）

像时间线一样浏览对话历史，在任意节点分叉探索不同路径。

1. 点击聊天工具栏的 **Rewind**
2. 拖动**滑块**浏览任意时间点
3. 当前点之后的消息变灰
4. **◀ ▶** 逐条导航，**Latest** 跳到最新
5. 点击 **Fork** 从当前点分叉：
   - 原始对话保存为分支
   - 从分叉点开始新对话
6. 工具栏 **Branches** 下拉菜单切换分支
7. hover 分支选项预览内容

### 9. 待办事项

悬浮任务卡片，所有页面可见：

- 拖拽标题栏移动位置
- 点击标题折叠/展开
- 输入框添加任务，Enter 确认
- checkbox 标记完成
- Agent 回复含"待办:"等关键词时自动建议
- Agent 报告完成时自动勾选
- 执行按钮：发送给 Agent / 自主执行 / Hive 协作
- 归档按钮：让 Agent 总结已完成任务

数据持久化到 ~/.ga-manager/todos.json

### 10. 监控

- 费用：请求数、Input/Output、缓存命中率、总计
- 系统：CPU、内存使用率
- 每 5 秒刷新

### 11. 设置

- 主题：深色/浅色
- 语言：中文/English
- 应用配置：GA Root、Python、端口
- mykey.py 编辑器
- 检查更新
- 重新配置

### 12. 自动更新

- 启动 15 秒后检查，之后每小时检查
- 发现新版本弹出通知
- 点击下载，完成后点击立即重启
- 或选择退出时安装

---

## 从源码构建

```bash
git clone https://github.com/chilishark27/ga-manager.git
cd ga-manager

# 前端
cd frontend && npm install && npm run build && cd ..

# 后端
cd backend
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/windows-amd64/ga-manager.exe .
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o ../build/darwin-arm64/ga-manager .
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o ../build/linux-amd64/ga-manager .
cd ..

# Electron
cd electron && npm install
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

---

## 致谢

- [GenericAgent](https://github.com/lsdefine/GenericAgent)
- Go, React, TypeScript, Electron
