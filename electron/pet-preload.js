const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  moveWindow: (x, y) => ipcRenderer.invoke('pet-move-window', x, y),
  getPosition: () => ipcRenderer.invoke('pet-get-position'),
  savePet: (petId) => ipcRenderer.invoke('pet-save-selection', petId),
  getSavedPet: () => ipcRenderer.invoke('pet-get-selection'),
  onStateChange: (cb) => ipcRenderer.on('pet-state-change', (_e, state) => cb(state)),
  getBackendUrl: () => ipcRenderer.invoke('pet-get-backend-url'),
});
