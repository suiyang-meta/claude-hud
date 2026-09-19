/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexAPI', {
  onUpdate: (cb) => ipcRenderer.on('codex:update', (e, p) => cb(p)),
  getData: () => ipcRenderer.send('codex:get-data'),
  refresh: () => ipcRenderer.send('codex:refresh'),
  fold: () => ipcRenderer.send('codex:fold'),
  fitHeight: (h) => ipcRenderer.send('codex:fit-height', h),
  openUsagePage: () => ipcRenderer.send('codex:open-usage'),
  contextMenu: () => ipcRenderer.send('codex:context-menu'),
});
