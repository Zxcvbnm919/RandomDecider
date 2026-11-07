const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  load: () => ipcRenderer.invoke('app:load'),
  save: (data) => ipcRenderer.invoke('app:save', data),
  loadBackground: () => ipcRenderer.invoke('background:load'),
  saveBackground: (arrayBuffer, ext) =>
    ipcRenderer.invoke('background:save', arrayBuffer, ext),
  clearBackground: () => ipcRenderer.invoke('background:clear'),
  exportFile: (name, content) => ipcRenderer.invoke('file:export', name, content),
  importFile: () => ipcRenderer.invoke('file:import'),
  getDataPath: () => ipcRenderer.invoke('app:dataPath'),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:is-maximized'),
})
