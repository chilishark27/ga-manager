const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 18600;
const BACKEND_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let tray = null;
let backendProcess = null;
let isQuitting = false;

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

// --- Auto Updater ---
function setupAutoUpdater() {
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
  if (backendProcess) {
    try { backendProcess.kill(); } catch {}
    backendProcess = null;
  }
  // Force quit after 3 seconds if something hangs
  setTimeout(() => { process.exit(0); }, 3000);
});
