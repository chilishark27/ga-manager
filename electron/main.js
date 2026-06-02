const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

// No GPU flags — keep full GPU acceleration for performance

const PORT = 18600;
const BACKEND_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;
let petWindow = null;

function getBackendPath() {
  const isPackaged = app.isPackaged;
  const resourcesPath = isPackaged ? process.resourcesPath : path.join(__dirname, '..');

  if (process.platform === 'win32') {
    return isPackaged
      ? path.join(resourcesPath, 'backend', 'ga-manager.exe')
      : path.join(resourcesPath, 'build', 'windows-amd64', 'ga-manager.exe');
  } else if (process.platform === 'darwin') {
    return isPackaged
      ? path.join(resourcesPath, 'backend', 'ga-manager')
      : path.join(resourcesPath, 'build', 'darwin-arm64', 'ga-manager');
  } else {
    return isPackaged
      ? path.join(resourcesPath, 'backend', 'ga-manager')
      : path.join(resourcesPath, 'build', 'linux-amd64', 'ga-manager');
  }
}

function startBackend() {
  const backendPath = getBackendPath();
  console.log(`Starting backend: ${backendPath}`);

  // Ensure Python is findable — macOS GUI apps have limited PATH
  const env = { ...process.env };
  if (process.platform === 'darwin') {
    const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
    const home = process.env.HOME || '';
    if (home) extraPaths.unshift(`${home}/.pyenv/shims`, `${home}/.local/bin`);
    env.PATH = extraPaths.join(':') + ':' + (env.PATH || '');
  }

  backendProcess = spawn(backendPath, ['--no-gui'], {
    cwd: path.dirname(backendPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env,
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });

  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });
}

function waitForBackend(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`${BACKEND_URL}/api/health`, (res) => {
        if (res.statusCode === 200) resolve();
        else if (Date.now() - start > timeout) reject(new Error('timeout'));
        else setTimeout(check, 300);
      }).on('error', () => {
        if (Date.now() - start > timeout) reject(new Error('timeout'));
        else setTimeout(check, 300);
      });
    };
    check();
  });
}

function getIconPath() {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app.asar.unpacked', iconName);
  }
  return path.join(__dirname, iconName);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GA Manager',
    icon: getIconPath(),
    frame: false,
    backgroundColor: '#1c1428',
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createPetWindow() {
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  const savedPos = { x: display.bounds.width - 300, y: display.bounds.height - 300 };

  petWindow = new BrowserWindow({
    width: 250,
    height: 250,
    x: savedPos.x,
    y: savedPos.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'pet-preload.js'),
    },
  });

  petWindow.loadURL(`${BACKEND_URL}/pet.html`);

  // Show after content is ready — prevents black flash on transparent window
  petWindow.once('ready-to-show', () => {
    petWindow.show();
    // Force compositor repaint to fix transparency on some Windows systems
    petWindow.setOpacity(0.99);
    setTimeout(() => { if (petWindow) petWindow.setOpacity(1); }, 50);
  });

  // Walk: main process moves window periodically
  let walkDir = 0; // -1 left, 0 stop, 1 right
  let walkSpeed = 2;

  setInterval(() => {
    if (!petWindow || walkDir === 0) return;
    try {
      const bounds = petWindow.getBounds();
      const { screen } = require('electron');
      const display = screen.getPrimaryDisplay();
      const newX = bounds.x + (walkDir * walkSpeed);
      if (newX < 0 || newX > display.bounds.width - bounds.width) {
        walkDir = 0;
        petWindow.webContents.send('pet-walk-done');
      } else {
        petWindow.setBounds({ x: newX, y: bounds.y, width: bounds.width, height: bounds.height });
      }
    } catch {}
  }, 30);

  ipcMain.on('pet-walk-start', (_, dir, speed) => {
    walkDir = dir; // -1 or 1
    walkSpeed = Math.max(2, speed || 2);
  });

  ipcMain.on('pet-walk-stop', () => { walkDir = 0; });

  // Drag: main process tracks cursor and moves window
  let petDragging = false;
  let dragOffsetX = 0, dragOffsetY = 0;
  let dragTimer = null;

  ipcMain.on('pet-drag-start', () => {
    if (!petWindow) return;
    petDragging = true;
    walkDir = 0;
    const { screen } = require('electron');
    const cursor = screen.getCursorScreenPoint();
    const bounds = petWindow.getBounds();
    dragOffsetX = cursor.x - bounds.x;
    dragOffsetY = cursor.y - bounds.y;
    dragTimer = setInterval(() => {
      if (!petWindow || !petDragging) return;
      const { screen } = require('electron');
      const cur = screen.getCursorScreenPoint();
      const b = petWindow.getBounds();
      petWindow.setBounds({ x: cur.x - dragOffsetX, y: cur.y - dragOffsetY, width: b.width, height: b.height });
    }, 16);
  });

  ipcMain.on('pet-drag-end', () => {
    petDragging = false;
    clearInterval(dragTimer);
  });

  petWindow.on('closed', () => { petWindow = null; walkDir = 0; petDragging = false; clearInterval(dragTimer); });
}

function createTray() {
  const iconPath = getIconPath();
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开管理面板', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; tray = null; app.quit(); } },
  ]);

  tray.setToolTip('GA Manager');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createWindow(); });
}

// --- Folder Picker ---
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select GenericAgent Directory',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('show-notification', (_, title, body) => {
  const { Notification } = require('electron');
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  }
});

ipcMain.handle('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window-maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });
ipcMain.handle('window-close', () => { if (mainWindow) mainWindow.close(); });

// --- Pet Window IPC ---
ipcMain.handle('pet-move-window', (_, x, y) => {
  if (petWindow) {
    const [w, h] = petWindow.getSize();
    petWindow.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h });
  }
});

ipcMain.handle('pet-get-position', () => {
  if (petWindow) {
    const bounds = petWindow.getBounds();
    return [bounds.x, bounds.y];
  }
  return [0, 0];
});

ipcMain.handle('pet-resize-window', (_, w, h) => {
  if (petWindow) petWindow.setSize(Math.round(w), Math.round(h));
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

ipcMain.handle('open-external', (_, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

// --- Auto Updater ---
function setupAutoUpdater() {
  let autoUpdater;
  try { autoUpdater = require('electron-updater').autoUpdater; } catch (e) { console.warn('Auto-updater not available:', e.message); return; }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || '',
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', {
        percent: Math.round(progress.percent),
        transferred: progress.transferred,
        total: progress.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.log('[Updater] Error:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err.message || String(err));
    }
  });

  ipcMain.handle('check-for-update', () => autoUpdater.checkForUpdates());
  ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
  ipcMain.handle('install-update', () => {
    isQuitting = true;
    if (backendProcess) {
      try { backendProcess.kill(); } catch {}
      backendProcess = null;
    }
    setTimeout(() => { autoUpdater.quitAndInstall(false, true); }, 500);
  });

  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 15000);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 60 * 60 * 1000);
}

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

app.on('window-all-closed', () => {
  // Keep running in tray on all platforms
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', (e) => {
  isQuitting = true;
  if (petWindow) { petWindow.destroy(); petWindow = null; }
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
    backendProcess = null;
  }
  // Force quit after 3 seconds if something hangs
  setTimeout(() => { process.exit(0); }, 3000);
});
