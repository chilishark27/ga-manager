const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 18600;
const BACKEND_URL = `http://localhost:${PORT}`;

let mainWindow = null;
let tray = null;
let backendProcess = null;

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

  backendProcess = spawn(backendPath, ['--no-gui'], {
    cwd: path.dirname(backendPath),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'GA Manager',
    icon: path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  const iconPath = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: '打开管理面板', click: () => { if (mainWindow) mainWindow.show(); else createWindow(); } },
    { type: 'separator' },
    { label: '退出', click: () => { tray = null; app.quit(); } },
  ]);

  tray.setToolTip('GA Manager');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); else createWindow(); });
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
});

app.on('window-all-closed', () => {
  // Keep running in tray on all platforms
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
});
