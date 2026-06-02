const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // Walk: tell main process to move window
  walkStart: (dir, speed) => ipcRenderer.send('pet-walk-start', dir, speed),
  walkStop: () => ipcRenderer.send('pet-walk-stop'),
  onWalkDone: (cb) => ipcRenderer.on('pet-walk-done', () => cb()),
  // Window management
  moveWindow: (x, y) => ipcRenderer.invoke('pet-move-window', x, y),
  getPosition: () => ipcRenderer.invoke('pet-get-position'),
  resizeWindow: (w, h) => ipcRenderer.invoke('pet-resize-window', w, h),
  // Pet selection
  savePet: (petId) => ipcRenderer.invoke('pet-save-selection', petId),
  getSavedPet: () => ipcRenderer.invoke('pet-get-selection'),
  // State
  onStateChange: (cb) => ipcRenderer.on('pet-state-change', (_e, state) => cb(state)),
  getBackendUrl: () => ipcRenderer.invoke('pet-get-backend-url'),
});
