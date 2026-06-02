# Desktop Pet Redesign: Dynamic Loading + Independent Window

## Summary

Redesign the desktop pet system to:
1. Dynamically load pet configurations from `act_conf.json` files in `frontend/public/pets/`
2. Move the pet into an independent Electron window that floats above all other windows, allowing the pet to be dragged anywhere on screen (not confined to the GA Manager window)

## Architecture

```
electron/main.js
  ├── mainWindow (GA Manager UI, no pet rendering)
  └── petWindow (transparent, frameless, always-on-top, 200x200)
        └── electron/pet.html
              - Loads pet animation engine
              - Reads act_conf.json from each pet folder
              - Handles drag (moves the window itself)
              - Click/right-click interactions
              - IPC: receives working/idle state from main window
```

## Pet Discovery

On startup, the pet renderer scans `/pets/` for subdirectories containing `act_conf.json`. Each valid directory becomes a selectable pet. The scan happens client-side via a backend API endpoint (`GET /api/pets`) that returns:

```json
[
  {
    "id": "纳西妲",
    "name": "纳西妲",
    "folder": "/pets/纳西妲",
    "actions": {
      "default": { "images": "hx", "frames": 25, "interval": 60 },
      "left_walk": { "images": "walk", "frames": 12, "interval": 60, "move": -3 },
      "right_walk": { "images": "walk2", "frames": 12, "interval": 60, "move": 3 },
      "drag": { "images": "t", "frames": 8, "interval": 60 },
      "fall": { "images": "fing", "frames": 6, "interval": 60 },
      "patpat": { "images": "mm", "frames": 10, "interval": 60 },
      "sleep": { "images": "sleep", "frames": 15, "interval": 60 }
    }
  }
]
```

Frame count is determined by counting `prefix_N.png` files in the `action/` subdirectory.

## Electron Pet Window

### Creation (main.js)
```javascript
petWindow = new BrowserWindow({
  width: 200, height: 200,
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  resizable: false,
  hasShadow: false,
  webPreferences: { preload: 'pet-preload.js' }
});
petWindow.setIgnoreMouseEvents(false);
```

### Dragging
When the user drags the pet image, the pet window itself moves (`petWindow.setPosition(x, y)` via IPC). This allows the pet to be anywhere on the screen.

### IPC Communication
- `main → petWindow`: instance status changes (working/idle), pet selection changes
- `petWindow → main`: position saves, pet selection from right-click menu
- `mainWindow → main → petWindow`: user changes pet in settings

### pet.html
A standalone HTML page that:
- Fetches `/api/pets` to get available pets and their configs
- Runs the frame animation engine (same logic as current DesktopPet.tsx but vanilla JS for independence)
- Handles auto-behavior (random walk, sleep, stand)
- Shows dialogue bubble on click
- Right-click opens pet selector

## Backend API

### GET /api/pets
Scans `frontend_dist/pets/` (or `frontend/public/pets/` in dev) for directories with `act_conf.json`. For each:
1. Parse act_conf.json
2. Count frames per action by listing `action/prefix_N.png` files
3. Return the pet list with computed frame counts

## Migration from Current System
- Remove DesktopPet.tsx from React app (it moves to Electron)
- Remove pet-related CSS from global.css
- Main window no longer renders the pet
- Pet state (selected pet, position) stored in electron-store or localStorage of pet window

## Interactions
- **Click**: random dialogue bubble + bounce animation
- **Drag**: drag frame shown, window follows mouse
- **Release after drag**: fall animation, then resume idle
- **Right-click**: pet selector popup
- **Auto behavior**: cycle stand → walk left/right → sleep → stand (3-7s intervals)
- **Working state**: when GA instance is busy, pet shows a "focus" or "work" animation if available, otherwise stands still

## Files to Create/Modify
- `electron/main.js` — add petWindow creation, IPC handlers
- `electron/pet-preload.js` — new, exposes IPC for pet window
- `electron/pet.html` — new, standalone pet renderer page
- `electron/pet-renderer.js` — new, animation engine + behavior logic
- `backend/main.go` — add GET /api/pets endpoint
- `frontend/src/components/DesktopPet.tsx` — remove (or keep as fallback for web-only mode)
- `frontend/src/App.tsx` — conditionally render DesktopPet only when not in Electron
- `frontend/src/styles/global.css` — remove pet-specific CSS (keep minimal for web fallback)
