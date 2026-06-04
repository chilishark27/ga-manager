# Pet State Reactions Design

## Overview

Add three reactive states to the desktop pet that respond to user activity and GA task lifecycle.

## States

### 1. Curious (User Active)

- **Trigger**: `powerMonitor.getSystemIdleTime() < 3` (polled every 3s in main process)
- **Condition**: GA is NOT in working state
- **Pet behavior**: Play a short idle action (patpat, cc, happy — whatever passes the existing idle filter)
- **Debounce**: Only trigger once per active session. Don't re-trigger until user goes idle (>10s) and comes back.
- **IPC**: Main process sends `pet-state-change: curious` to pet window

### 2. Working (GA Running)

- **Trigger**: GA instance starts running (backend sends state change)
- **Pet behavior**: Play `work` action (existing) + show bubble "正在工作中..."
- **Bubble**: Stays visible for entire working duration (don't auto-hide after 2.5s like normal bubbles)
- **IPC**: `pet-state-change: working` (already exists, just need bubble addition)

### 3. Done (GA Task Finished)

- **Trigger**: GA instance stops (backend sends state change from working → idle)
- **Pet behavior**: Play `happy` or `dance` action + show bubble "任务完成啦~"
- **System notification**: Electron `Notification` with title "GA Manager" body "任务完成"
- **Bubble**: Auto-hide after 5 seconds
- **IPC**: `pet-state-change: done` (new state value)

## Implementation Scope

### Main Process (electron/main.js)

1. Add `powerMonitor.getSystemIdleTime()` polling (setInterval every 3s)
2. Track `userActive` state with debounce logic
3. Send `pet-state-change` with values: `curious`, `working`, `done`
4. Fire Electron Notification on `done`

### Backend (Go)

- When GA instance transitions from running → stopped, send `done` state via existing WebSocket/IPC mechanism
- Currently sends `working`/`idle` — change `idle` to `done` when previous state was `working`

### Pet Renderer (pet-renderer.js)

- Handle `curious` state: clear autoTimer, play a random idle action, resume scheduleAuto after
- Handle `working` state: play work action + show persistent bubble "正在工作中..."
- Handle `done` state: play happy/dance + show bubble "任务完成啦~" for 5s, then resume idle

### Priority

States have priority: `working` > `done` > `curious` > `idle`

If GA is working, curious detection is suppressed. Done state plays once then returns to idle behavior.

## Out of Scope

- Custom curious animation assets (uses existing pet actions)
- Per-pet notification sounds
- Configurable bubble text
