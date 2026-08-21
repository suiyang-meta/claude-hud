/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
// button-preload.js — exposes buttonAPI to the pet button window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buttonAPI', {
  ready: () => ipcRenderer.send('button:ready'),
  click: () => ipcRenderer.send('button:click'),
  onActivePet: (cb) => ipcRenderer.on('button:active-pet', (e, p) => cb(p)),
  onHoverChange: (cb) => ipcRenderer.on('button:hover', (e, over) => cb(over)),
});
