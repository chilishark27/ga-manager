# Pet State Reactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add curious/working/done reactive states to the desktop pet window.

**Architecture:** Main process polls `powerMonitor.getSystemIdleTime()` for curious state. Frontend main window sends IPC when GA status changes (working/done). Main process forwards all state changes to pet window via `pet-state-change` IPC. Pet renderer handles animations and bubbles.

**Tech Stack:** Electron IPC, powerMonitor API, Electron Notification API

---

### Task 1: Main Process — Add state forwarding and idle detection

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: Add powerMonitor import and state tracking variables**

At the top of `main.js`, add `powerMonitor` to the require destructuring, and add state variables after the existing globals:

```javascript
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, powerMonitor, Notification } = require('electron');
```

After `let petWindow = null;` (around line 16), add:

```javascript
let petState = 'idle'; // idle | curious | working | done
let userWasIdle = true;
```

- [ ] **Step 2: Add idle detection polling after pet window creation**

Inside `createPetWindow()`, after the `petWindow.on('closed', ...)` line, add the idle detection interval:

```javascript
  // User activity detection for curious state
  setInterval(() => {
    if (!petWindow || petState === 'working') return;
    const idleTime = powerMonitor.getSystemIdleTime();
    if (idleTime < 3 && userWasIdle) {
      // User just became active
      userWasIdle = false;
      petState = 'curious';
      petWindow.webContents.send('pet-state-change', 'curious');
    } else if (idleTime > 10 && !userWasIdle) {
      // User went idle
      userWasIdle = true;
      if (petState === 'curious') {
        petState = 'idle';
        petWindow.webContents.send('pet-state-change', 'idle');
      }
    }
  }, 3000);
```

- [ ] **Step 3: Add IPC handler for GA state from main window**

After the existing `ipcMain.handle('open-external', ...)` block, add:

```javascript
ipcMain.on('ga-state-change', (_, state) => {
  if (!petWindow) return;
  if (state === 'working') {
    petState = 'working';
    petWindow.webContents.send('pet-state-change', 'working');
  } else if (state === 'done') {
    petState = 'done';
    petWindow.webContents.send('pet-state-change', 'done');
    // System notification
    if (Notification.isSupported()) {
      new Notification({ title: 'GA Manager', body: '任务完成' }).show();
    }
    // Reset to idle after 5 seconds
    setTimeout(() => {
      if (petState === 'done') {
        petState = 'idle';
        petWindow.webContents.send('pet-state-change', 'idle');
      }
    }, 5000);
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add electron/main.js
git commit -m "feat: add pet state forwarding + idle detection + notification"
```

---

### Task 2: Main Window Preload — Expose GA state sender

**Files:**
- Modify: `electron/preload.js`

- [ ] **Step 1: Add gaState sender to preload**

Add a new `electronPet` context bridge after the existing `electronShell` block:

```javascript
contextBridge.exposeInMainWorld('electronPet', {
  sendState: (state) => ipcRenderer.send('ga-state-change', state),
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose electronPet.sendState in main window preload"
```

---

### Task 3: Frontend — Send GA state changes to main process

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (or wherever GA instance status is tracked)

- [ ] **Step 1: Find where instance status changes and add state notifications**

In the frontend, find where `activeInstance.status` transitions are detected. Add calls to `window.electronPet?.sendState()`:

```typescript
// When GA starts working (status becomes 'running' or 'busy'):
if (window.electronPet) window.electronPet.sendState('working');

// When GA stops (status becomes 'stopped' from 'running'):
if (window.electronPet) window.electronPet.sendState('done');
```

Look in the store or the component that monitors instance status. The exact location depends on where `instances` state updates happen — likely in a useEffect or WebSocket handler that receives status updates.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat: send GA working/done state to electron main process"
```

---

### Task 4: Pet Renderer — Handle all states with animations and bubbles

**Files:**
- Modify: `frontend/public/pet-renderer.js`

- [ ] **Step 1: Rewrite the onStateChange handler**

Replace the existing `onStateChange` handler inside `init()` with:

```javascript
    if (window.petBridge) {
      window.petBridge.onStateChange((state) => {
        const pet = currentPet();
        if (!pet) return;

        if (state === 'working') {
          clearTimeout(autoTimer);
          if (pet.actions.work) setAction('work');
          bubble.textContent = '正在工作中...';
          bubble.style.display = 'block';
        } else if (state === 'done') {
          clearTimeout(autoTimer);
          const doneAction = pet.actions.happy || pet.actions.dance || pet.actions.patpat;
          if (doneAction) {
            const name = pet.actions.happy ? 'happy' : pet.actions.dance ? 'dance' : 'patpat';
            setAction(name);
          }
          bubble.textContent = '任务完成啦~';
          bubble.style.display = 'block';
          setTimeout(() => { bubble.style.display = 'none'; }, 5000);
          autoTimer = setTimeout(() => { setAction('default'); scheduleAuto(); }, 5000);
        } else if (state === 'curious') {
          // Only react if in idle state (not working/done)
          if (action === 'default' || action === 'idle') {
            clearTimeout(autoTimer);
            const idleActions = getIdleActions(pet);
            if (idleActions.length > 0) {
              const pick = idleActions[Math.floor(Math.random() * idleActions.length)];
              const act = pet.actions[pick];
              setAction(pick);
              const duration = act.frames * act.interval;
              autoTimer = setTimeout(() => { setAction('default'); scheduleAuto(); }, duration);
            }
          }
        } else if (state === 'idle') {
          bubble.style.display = 'none';
          if (action === 'work') {
            setAction('default');
            scheduleAuto();
          }
        }
      });
    }
```

- [ ] **Step 2: Extract getIdleActions helper**

Add this helper function before `scheduleAuto()`:

```javascript
function getIdleActions(pet) {
  const skipActions = ['default', 'drag', 'work', 'hide', 'faint', 'fall', 'onfloor', 'prefall', 'edge', 'left', 'right', 'up', 'down'];
  return Object.keys(pet.actions).filter(a => {
    if (skipActions.includes(a)) return false;
    if (a.includes('walk')) return false;
    if (a.startsWith('feed')) return false;
    const act = pet.actions[a];
    if (act.frames * act.interval < 1500) return false;
    return true;
  });
}
```

Then update `scheduleAuto()` to use it:

```javascript
    const walkActions = Object.keys(pet.actions).filter(a => a.includes('walk'));
    const idleActions = getIdleActions(pet);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/public/pet-renderer.js
git commit -m "feat: pet reacts to curious/working/done states with animations + bubble"
```

---

### Task 5: Sync dist copies and bump version

**Files:**
- Modify: `electron/package.json`
- Copy: `frontend/public/pet-renderer.js` → all dist locations

- [ ] **Step 1: Sync pet-renderer.js to all dist locations**

```bash
cp frontend/public/pet-renderer.js frontend_dist/pet-renderer.js
cp frontend/public/pet-renderer.js backend/frontend_dist/pet-renderer.js
cp frontend/public/pet-renderer.js electron/pet-renderer.js
```

- [ ] **Step 2: Bump version**

In `electron/package.json`, change version to `"2.51.0"`.

- [ ] **Step 3: Commit and tag**

```bash
git add -A
git commit -m "feat: pet state reactions - curious/working/done with notifications"
git tag v2.51.0
git push origin main
git push origin v2.51.0
```
