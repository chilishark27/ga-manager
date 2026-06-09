# IM Channels & Frontend Services Design

## Overview

Add a "通道" (Channels) page to GA Manager that manages IM channel credentials and frontend service processes, mirroring the GA Admin "通道与前端服务" functionality.

## Architecture

Two-panel layout:
- **Left: Key Configuration** — Read/write IM credentials in `{gaRoot}/mykey.py`
- **Right: Frontend Services** — Start/stop/monitor Python frontend processes

## Key Configuration (Left Panel)

### Supported Channels

| Channel | Variables in mykey.py | Script |
|---------|----------------------|--------|
| 飞书 (Lark) | `fs_app_id`, `fs_app_secret`, `fs_allowed_users`, `fs_public_access` | fsapp.py |
| 企业微信 (WeCom) | `wecom_bot_id`, `wecom_secret`, `wecom_allowed_users` | wecomapp.py |
| 钉钉 (DingTalk) | `dingtalk_app_key`, `dingtalk_app_secret`, `dingtalk_allowed_users` | dingtalkapp.py |
| Telegram | `tg_token`, `tg_allowed_users` | tgapp.py |
| QQ | `qq_appid`, `qq_secret` | qqapp.py |
| Discord | `dc_token`, `dc_allowed_users` | dcapp.py |

### Behavior

- Read mykey.py on page load, parse Python variable assignments
- Display each channel's fields with current values (secrets show "已保存" placeholder, not raw value)
- "保存" writes modified values back to mykey.py
- "刷新" re-reads from file
- "测试连接" calls a lightweight validation (e.g., for Telegram: `getMe` API)

### mykey.py Parsing

Parse simple Python assignments: `variable_name = 'value'` or `variable_name = "value"`.
Only read/write the IM-related variables, leave everything else untouched.

## Frontend Services (Right Panel)

### Behavior

- Scan `{gaRoot}/frontends/*.py` for known frontend scripts
- Show each as a card with: name, PID (if running), status badge
- "启动" button: `python -u {gaRoot}/frontends/{script}.py`, CWD = gaRoot
- "停止" button: kill the process
- "查看" button: open log output (captured stdout/stderr)
- Track running processes in memory (map of script name → *exec.Cmd)

### Known Frontend Scripts

Display-friendly names:
- `fsapp.py` → "飞书 Bot"
- `wecomapp.py` → "企业微信 Bot"
- `dingtalkapp.py` → "钉钉 Bot"
- `tgapp.py` → "Telegram Bot"
- `qqapp.py` → "QQ Bot"
- `dcapp.py` → "Discord Bot"
- `wechatapp.py` → "微信 Bot"
- `stapp.py` → "Streamlit Web"
- `qtapp.py` → "Desktop GUI"

## Backend API

New file: `backend/handlers/channels.go`

### Endpoints

```
GET  /api/channels/keys          — Read IM config from mykey.py
POST /api/channels/keys          — Write IM config to mykey.py
POST /api/channels/keys/test     — Test connection for a specific channel

GET  /api/channels/services      — List available frontend scripts + running status
POST /api/channels/services/start  — Start a frontend service (body: {script: "fsapp.py"})
POST /api/channels/services/stop   — Stop a frontend service (body: {script: "fsapp.py"})
GET  /api/channels/services/logs   — Get recent logs for a service (query: ?script=fsapp.py)
```

### Key parsing logic

```go
// Read: regex scan for `varname = 'value'` or `varname = "value"`
// Write: replace the line matching `varname = ...` with new value
// If variable doesn't exist, append at end of file
```

## Frontend

New file: `frontend/src/pages/ChannelsPage.tsx`

- Register in nav as "通道" with an icon
- Two-column layout (responsive: stack on narrow screens)
- Left: accordion sections per channel, each with input fields
- Right: service cards with status indicators and action buttons

## Security

- Secret values (app_secret, tokens) are write-only from the frontend: backend returns `"***"` for existing secrets, only writes if the value != `"***"`
- mykey.py file permissions preserved on write

## Out of Scope

- Auto-detecting which channels have valid credentials
- Webhook URL configuration for IM platforms
- Service auto-restart on crash
