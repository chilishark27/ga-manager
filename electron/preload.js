const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronUpdater', {
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, info) => cb(info)),
  onUpdateProgress: (cb) => ipcRenderer.on('update-progress', (_e, progress) => cb(progress)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update-error', (_e, err) => cb(err)),
});

contextBridge.exposeInMainWorld('electronDialog', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
});

contextBridge.exposeInMainWorld('electronFile', {
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  },
});

contextBridge.exposeInMainWorld('electronNotify', {
  send: (title, body) => ipcRenderer.invoke('show-notification', title, body),
});

contextBridge.exposeInMainWorld('electronShell', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
