const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petBridge', {
  // Drag: fire-and-forget (main process tracks cursor)
  dragStart: () => ipcRenderer.send('pet-drag-start'),
  dragMove: () => ipcRenderer.send('pet-drag-move'),
  dragEnd: () => ipcRenderer.send('pet-drag-end'),
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
