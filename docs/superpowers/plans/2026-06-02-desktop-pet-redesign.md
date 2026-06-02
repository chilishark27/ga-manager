# Desktop Pet Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move desktop pet into an independent Electron window with full DyberPet-style frame animation, dynamic pet discovery from act_conf.json files, and screen-wide dragging.

**Architecture:** A new transparent always-on-top Electron BrowserWindow renders the pet independently from the main app. A Go backend endpoint scans pet directories and returns configs. The pet window uses vanilla JS for animation and IPC for window dragging and state sync.

**Tech Stack:** Electron (BrowserWindow, IPC), Go (backend API), Vanilla JS (pet renderer), HTML/CSS (pet window)

---

### Task 1: Backend API — GET /api/pets

**Files:**
- Modify: `backend/main.go` (add endpoint near line 750, before static file serving)

- [ ] **Step 1: Add the /api/pets endpoint**

In `backend/main.go`, add this handler before the static file serving section (before line 754):

```go
// Pet discovery API
mux.HandleFunc("GET /api/pets", func(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")

    // Find pets directory
    petsDir := ""
    candidates := []string{
        filepath.Join(getExeDir(), "static", "pets"),
        filepath.Join(".", "static", "pets"),
    }
    if cwd, err := os.Getwd(); err == nil {
        candidates = append(candidates,
            filepath.Join(cwd, "frontend", "public", "pets"),
            filepath.Join(cwd, "..", "frontend", "public", "pets"),
            filepath.Join(cwd, "static", "pets"),
        )
    }
    if staticDir != "" {
        candidates = append([]string{filepath.Join(staticDir, "pets")}, candidates...)
    }
    for _, c := range candidates {
        if info, err := os.Stat(c); err == nil && info.IsDir() {
            petsDir = c
            break
        }
    }
    if petsDir == "" {
        json.NewEncoder(w).Encode([]interface{}{})
        return
    }

    entries, err := os.ReadDir(petsDir)
    if err != nil {
        json.NewEncoder(w).Encode([]interface{}{})
        return
    }

    type PetAction struct {
        Images   string `json:"images"`
        Frames   int    `json:"frames"`
        Interval int    `json:"interval"`
        NeedMove bool   `json:"need_move,omitempty"`
        Direction string `json:"direction,omitempty"`
        FrameMove int   `json:"frame_move,omitempty"`
    }
    type PetInfo struct {
        ID      string                `json:"id"`
        Name    string                `json:"name"`
        Folder  string                `json:"folder"`
        Actions map[string]PetAction  `json:"actions"`
    }

    var pets []PetInfo
    for _, entry := range entries {
        if !entry.IsDir() {
            continue
        }
        confPath := filepath.Join(petsDir, entry.Name(), "act_conf.json")
        if _, err := os.Stat(confPath); err != nil {
            continue
        }
        data, err := os.ReadFile(confPath)
        if err != nil {
            continue
        }

        var rawConf map[string]map[string]interface{}
        if err := json.Unmarshal(data, &rawConf); err != nil {
            continue
        }

        actionDir := filepath.Join(petsDir, entry.Name(), "action")
        actions := make(map[string]PetAction)

        for actionName, actionData := range rawConf {
            images, _ := actionData["images"].(string)
            if images == "" {
                continue
            }
            // Count frames
            frameCount := 0
            if entries2, err := os.ReadDir(actionDir); err == nil {
                for _, f := range entries2 {
                    if strings.HasPrefix(f.Name(), images+"_") && strings.HasSuffix(f.Name(), ".png") {
                        frameCount++
                    }
                }
            }
            if frameCount == 0 {
                continue
            }

            interval := 100
            if fr, ok := actionData["frame_refresh"].(float64); ok && fr > 0 {
                interval = int(fr * 1000)
            }

            act := PetAction{
                Images:   images,
                Frames:   frameCount,
                Interval: interval,
            }
            if needMove, ok := actionData["need_move"].(bool); ok {
                act.NeedMove = needMove
            }
            if dir, ok := actionData["direction"].(string); ok {
                act.Direction = dir
            }
            if fm, ok := actionData["frame_move"].(float64); ok {
                act.FrameMove = int(fm)
            }

            actions[actionName] = act
        }

        if len(actions) == 0 {
            continue
        }

        pets = append(pets, PetInfo{
            ID:      entry.Name(),
            Name:    entry.Name(),
            Folder:  "/pets/" + entry.Name(),
            Actions: actions,
        })
    }

    json.NewEncoder(w).Encode(pets)
})
```

- [ ] **Step 2: Build and verify**

Run:
```bash
cd backend && go build -o ../build/windows-amd64/ga-manager.exe .
```

Then start the backend and test:
```bash
curl http://localhost:18600/api/pets
```

Expected: JSON array with pet entries containing actions and frame counts.

- [ ] **Step 3: Commit**

```bash
git add backend/main.go
git commit -m "feat: add GET /api/pets endpoint for dynamic pet discovery"
```

---

### Task 2: Electron Pet Preload

**Files:**
- Create: `electron/pet-preload.js`

- [ ] **Step 1: Create pet-preload.js**

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // Move the pet window
  moveWindow: (x, y) => ipcRenderer.invoke('pet-move-window', x, y),
  // Get current window position
  getPosition: () => ipcRenderer.invoke('pet-get-position'),
  // Save selected pet
  savePet: (petId) => ipcRenderer.invoke('pet-save-selection', petId),
  // Get saved pet
  getSavedPet: () => ipcRenderer.invoke('pet-get-selection'),
  // Listen for state changes from main window
  onStateChange: (cb) => ipcRenderer.on('pet-state-change', (_e, state) => cb(state)),
  // Get backend URL
  getBackendUrl: () => ipcRenderer.invoke('pet-get-backend-url'),
});
```

- [ ] **Step 2: Commit**

```bash
git add electron/pet-preload.js
git commit -m "feat: add pet window preload script"
```

---

### Task 3: Pet Renderer (pet.html + pet-renderer.js)

**Files:**
- Create: `electron/pet.html`
- Create: `electron/pet-renderer.js`

- [ ] **Step 1: Create pet.html**

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { background: transparent; overflow: hidden; width: 200px; height: 200px; user-select: none; }
#pet-container { position: relative; width: 200px; height: 200px; display: flex; align-items: center; justify-content: center; cursor: grab; }
#pet-container:active { cursor: grabbing; }
#pet-img { width: 128px; height: 128px; object-fit: contain; image-rendering: pixelated; pointer-events: none; }
#pet-bubble { position: absolute; top: 5px; left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid #e0c0d0; border-radius: 12px; padding: 4px 10px; font-size: 12px; font-family: -apple-system, sans-serif; color: #333; white-space: nowrap; box-shadow: 0 2px 6px rgba(0,0,0,0.1); display: none; z-index: 10; }
#pet-bubble::after { content:''; position: absolute; bottom: -5px; left: 50%; transform: translateX(-50%); border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid #fff; }
#pet-name { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); font-size: 10px; color: #999; font-family: -apple-system, sans-serif; opacity: 0; transition: opacity 0.2s; }
#pet-container:hover #pet-name { opacity: 1; }
#selector { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%); background: #fff; border: 1px solid #e0c0d0; border-radius: 10px; padding: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12); display: none; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 240px; max-height: 300px; overflow-y: auto; z-index: 100; }
#selector.show { display: grid; }
.sel-item { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px; border-radius: 8px; cursor: pointer; border: 2px solid transparent; transition: all 0.15s; }
.sel-item:hover { background: #fef0f4; border-color: #f0c0d0; }
.sel-item.active { border-color: #d4729a; background: #fef0f4; }
.sel-item img { width: 40px; height: 40px; object-fit: contain; image-rendering: pixelated; }
.sel-item span { font-size: 9px; color: #666; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60px; }
@keyframes bounce { 0%{transform:scale(1)} 20%{transform:scale(0.85) rotate(-5deg)} 50%{transform:scale(1.15) rotate(3deg)} 70%{transform:scale(0.95)} 100%{transform:scale(1)} }
.bounce { animation: bounce 0.4s ease; }
</style>
</head>
<body>
<div id="pet-container">
  <div id="pet-bubble"></div>
  <img id="pet-img" src="" alt="pet">
  <div id="pet-name"></div>
  <div id="selector"></div>
</div>
<script src="pet-renderer.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create pet-renderer.js**

```javascript
const DIALOGUES_ZH = ['喵~','别戳我！','嗯？','想我了？','(´・ω・`)','有什么事吗~','好无聊啊...','陪我玩！','哼！','摸摸头~','在忙呢...','嘿嘿~','干嘛啦~','好痒！'];
const DIALOGUES_EN = ['Meow~',"Don't poke me!",'Hmm?','Miss me?','(´・ω・`)',"What's up~","So bored...",'Play with me!','Hmph!','Pat pat~',"I'm busy...",'Hehe~','What~','That tickles!'];

let pets = [];
let currentPetIdx = 0;
let action = 'default';
let frameIdx = 0;
let animTimer = null;
let autoTimer = null;
let isDragging = false;
let dragStartX = 0, dragStartY = 0;
let winStartX = 0, winStartY = 0;
let backendUrl = 'http://localhost:18600';

const img = document.getElementById('pet-img');
const bubble = document.getElementById('pet-bubble');
const nameEl = document.getElementById('pet-name');
const selector = document.getElementById('selector');
const container = document.getElementById('pet-container');

async function init() {
  backendUrl = await window.petBridge.getBackendUrl();
  const savedPet = await window.petBridge.getSavedPet();
  const pos = await window.petBridge.getPosition();

  try {
    const res = await fetch(`${backendUrl}/api/pets`);
    pets = await res.json();
  } catch { pets = []; }

  if (pets.length === 0) { img.alt = 'No pets found'; return; }

  currentPetIdx = Math.max(0, pets.findIndex(p => p.id === savedPet));
  buildSelector();
  startPet();

  window.petBridge.onStateChange((state) => {
    if (state === 'working' && pets[currentPetIdx]?.actions?.work) {
      setAction('work');
    } else if (state === 'idle' && action === 'work') {
      setAction('default');
    }
  });
}

function currentPet() { return pets[currentPetIdx]; }

function buildSelector() {
  selector.innerHTML = '';
  pets.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = `sel-item ${idx === currentPetIdx ? 'active' : ''}`;
    const act = p.actions.default || Object.values(p.actions)[0];
    div.innerHTML = `<img src="${backendUrl}${p.folder}/action/${act.images}_0.png"><span>${p.name}</span>`;
    div.onclick = (e) => { e.stopPropagation(); selectPet(idx); };
    selector.appendChild(div);
  });
}

function selectPet(idx) {
  currentPetIdx = idx;
  window.petBridge.savePet(pets[idx].id);
  selector.classList.remove('show');
  buildSelector();
  stopAnim();
  startPet();
}

function startPet() {
  const pet = currentPet();
  if (!pet) return;
  nameEl.textContent = pet.name;
  setAction('default');
  scheduleAuto();
}

function setAction(name) {
  const pet = currentPet();
  if (!pet) return;
  const act = pet.actions[name] || pet.actions.default;
  if (!act) return;
  action = name;
  frameIdx = 0;
  stopAnim();
  updateFrame();
  animTimer = setInterval(() => {
    frameIdx = (frameIdx + 1) % act.frames;
    updateFrame();
    if (act.need_move && !isDragging) {
      const move = act.frame_move || 3;
      const dir = act.direction === 'left' ? -move : move;
      window.petBridge.getPosition().then(pos => {
        const newX = pos[0] + dir;
        if (newX < 0 || newX > screen.width - 200) {
          setAction('default');
        } else {
          window.petBridge.moveWindow(newX, pos[1]);
        }
      });
    }
  }, act.interval);
}

function updateFrame() {
  const pet = currentPet();
  const act = pet.actions[action] || pet.actions.default;
  img.src = `${backendUrl}${pet.folder}/action/${act.images}_${frameIdx}.png`;
}

function stopAnim() { clearInterval(animTimer); animTimer = null; }

function scheduleAuto() {
  clearTimeout(autoTimer);
  if (isDragging) return;
  autoTimer = setTimeout(() => {
    if (isDragging) return;
    const pet = currentPet();
    if (!pet) return;
    const rand = Math.random();
    if (rand < 0.25 && pet.actions.left_walk) {
      setAction('left_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 3000);
    } else if (rand < 0.5 && pet.actions.right_walk) {
      setAction('right_walk');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 3000);
    } else if (rand < 0.65 && pet.actions.sleep) {
      setAction('sleep');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 5000);
    } else {
      setAction('default');
      scheduleAuto();
    }
  }, 3000 + Math.random() * 4000);
}

// Drag
container.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.screenX;
  dragStartY = e.screenY;
  window.petBridge.getPosition().then(pos => { winStartX = pos[0]; winStartY = pos[1]; });
  const pet = currentPet();
  if (pet?.actions?.drag) setAction('drag');
  clearTimeout(autoTimer);
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.screenX - dragStartX;
  const dy = e.screenY - dragStartY;
  window.petBridge.moveWindow(winStartX + dx, winStartY + dy);
});

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  const pet = currentPet();
  if (pet?.actions?.fall) {
    setAction('fall');
    setTimeout(() => {
      if (pet?.actions?.onfloor) {
        setAction('onfloor');
        setTimeout(() => { setAction('default'); scheduleAuto(); }, 1500);
      } else {
        setAction('default'); scheduleAuto();
      }
    }, 800);
  } else {
    setAction('default'); scheduleAuto();
  }
});

// Click
container.addEventListener('click', (e) => {
  if (e.detail === 1 && !isDragging) {
    // Bounce
    img.classList.add('bounce');
    setTimeout(() => img.classList.remove('bounce'), 400);
    // Bubble
    const msgs = DIALOGUES_ZH;
    bubble.textContent = msgs[Math.floor(Math.random() * msgs.length)];
    bubble.style.display = 'block';
    setTimeout(() => { bubble.style.display = 'none'; }, 2500);
    // Patpat animation
    const pet = currentPet();
    const patpat = pet?.actions?.patpat || pet?.actions?.patpat_1;
    if (patpat) {
      setAction(pet.actions.patpat ? 'patpat' : 'patpat_1');
      setTimeout(() => { setAction('default'); scheduleAuto(); }, 2000);
    }
  }
});

// Right-click: selector
container.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  selector.classList.toggle('show');
});

// Close selector on outside click
document.addEventListener('click', (e) => {
  if (!selector.contains(e.target) && selector.classList.contains('show')) {
    selector.classList.remove('show');
  }
});

init();
```

- [ ] **Step 3: Commit**

```bash
git add electron/pet.html electron/pet-renderer.js
git commit -m "feat: add standalone pet window renderer with frame animation"
```

---

### Task 4: Electron Main — Pet Window + IPC

**Files:**
- Modify: `electron/main.js`

- [ ] **Step 1: Add petWindow variable and creation function**

Add after `let isQuitting = false;` (line 13):

```javascript
let petWindow = null;
```

Add a `createPetWindow` function after `createWindow()` function (after line 125):

```javascript
function createPetWindow() {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const savedPos = { x: display.bounds.width - 250, y: display.bounds.height - 250 };

  petWindow = new BrowserWindow({
    width: 200,
    height: 200,
    x: savedPos.x,
    y: savedPos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'pet-preload.js'),
    },
  });

  petWindow.loadFile(path.join(__dirname, 'pet.html'));
  petWindow.setIgnoreMouseEvents(false);

  petWindow.on('closed', () => { petWindow = null; });
}
```

- [ ] **Step 2: Add IPC handlers for pet window**

Add after the `window-close` IPC handler (after line 166):

```javascript
// --- Pet Window IPC ---
ipcMain.handle('pet-move-window', (_, x, y) => {
  if (petWindow) petWindow.setPosition(Math.round(x), Math.round(y));
});

ipcMain.handle('pet-get-position', () => {
  if (petWindow) return petWindow.getPosition();
  return [0, 0];
});

ipcMain.handle('pet-save-selection', (_, petId) => {
  global.selectedPet = petId;
});

ipcMain.handle('pet-get-selection', () => {
  return global.selectedPet || '';
});

ipcMain.handle('pet-get-backend-url', () => {
  return BACKEND_URL;
});
```

- [ ] **Step 3: Call createPetWindow after createWindow in app.whenReady**

Modify the `app.whenReady()` block to also create the pet window:

```javascript
app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForBackend();
    console.log('Backend ready');
  } catch (e) {
    console.error('Backend failed to start:', e.message);
    app.quit();
    return;
  }

  createTray();
  createWindow();
  createPetWindow();
  setupAutoUpdater();
});
```

- [ ] **Step 4: Close petWindow on quit**

In the `before-quit` handler, add:

```javascript
app.on('before-quit', (e) => {
  isQuitting = true;
  if (petWindow) { petWindow.destroy(); petWindow = null; }
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
    backendProcess = null;
  }
  setTimeout(() => { process.exit(0); }, 3000);
});
```

- [ ] **Step 5: Commit**

```bash
git add electron/main.js
git commit -m "feat: create independent pet window in Electron main process"
```

---

### Task 5: Remove Pet from React App (Web Fallback)

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Conditionally render DesktopPet only in web mode**

Change line 94 in App.tsx from:
```tsx
<DesktopPet />
```
to:
```tsx
{!(window as any).petBridge && <DesktopPet />}
```

This keeps the React pet as a fallback when running in browser (not Electron), but hides it when the standalone pet window is active.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat: hide React pet when Electron pet window is active"
```

---

### Task 6: Add Project Delete Button CSS

**Files:**
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Add CSS for project delete button**

Add after `.top-bar-project-opt-icon` rule (near line 226):

```css
.top-bar-project-del { display: none; font-size: 12px; color: var(--text-3); cursor: pointer; padding: 2px 4px; border-radius: 4px; line-height: 1; }
.top-bar-project-del:hover { color: var(--red); background: rgba(239, 68, 68, 0.08); }
.top-bar-project-option:hover .top-bar-project-del { display: block; }
```

- [ ] **Step 2: Build frontend**

```bash
cd frontend && npx vite build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/styles/global.css
git commit -m "fix: add delete button styling for project dropdown"
```

---

### Task 7: Build, Bump Version, Release

**Files:**
- Modify: `electron/package.json`
- Copy: dist assets

- [ ] **Step 1: Build frontend and copy to dist**

```bash
cd frontend && npx vite build
# Copy to backend dist
rm backend/frontend_dist/assets/*
cp frontend/dist/assets/* backend/frontend_dist/assets/
cp frontend/dist/index.html backend/frontend_dist/index.html
# Copy to root dist
rm frontend_dist/assets/*
cp frontend/dist/assets/* frontend_dist/assets/
cp frontend/dist/index.html frontend_dist/index.html
```

- [ ] **Step 2: Build backend**

```bash
cd backend && go build -o ../build/windows-amd64/ga-manager.exe .
```

- [ ] **Step 3: Bump version**

In `electron/package.json`, change version to `"2.17.0"`.

- [ ] **Step 4: Commit and tag**

```bash
git add -A
git commit -m "feat: desktop pet independent window + dynamic loading (v2.17.0)"
git tag v2.17.0
git push origin main --tags
```

- [ ] **Step 5: Create GitHub release**

```bash
gh release create v2.17.0 --title "v2.17.0 - Independent Pet Window" --notes "..."
```
