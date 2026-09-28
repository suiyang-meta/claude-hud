/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sysAPI', {
  onUpdate: (cb) => ipcRenderer.on('sys:update', (e, p) => cb(p)),
  getData: () => ipcRenderer.send('sys:get-data'),
  refresh: () => ipcRenderer.send('sys:refresh'),
  fold: () => ipcRenderer.send('sys:fold'),
  fitHeight: (h) => ipcRenderer.send('sys:fit-height', h),
  contextMenu: () => ipcRenderer.send('sys:context-menu'),
  scanDisk: () => ipcRenderer.send('sys:scan-disk'),
  // A folder from the last disk scan, shown in Finder.
  reveal: (p) => ipcRenderer.send('sys:reveal', p),
  openActivityMonitor: () => ipcRenderer.send('sys:activity-monitor'),
});
