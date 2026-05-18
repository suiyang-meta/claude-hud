const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hudAPI', {
  onUsageUpdate: (cb) => ipcRenderer.on('usage-update', (e, data) => cb(data)),
  onHoverChange: (cb) => ipcRenderer.on('hover-change', (e, val) => cb(val)),
  onConnectionChange: (cb) => ipcRenderer.on('connection-change', (e, val) => cb(val)),
  setOpacity: (val) => ipcRenderer.send('set-opacity', val),
  close: () => ipcRenderer.send('close-app'),
  getData: () => ipcRenderer.send('get-data'),
  showContextMenu: () => ipcRenderer.send('show-context-menu'),
  getAutoStart: () => ipcRenderer.invoke('get-autostart'),
  setAutoStart: (enabled) => ipcRenderer.send('set-autostart', enabled)
});
