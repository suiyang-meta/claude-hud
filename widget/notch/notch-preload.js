/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notchAPI', {
  onState: (cb) => ipcRenderer.on('notch:state', (e, s) => cb(s)),
  onUpdate: (cb) => ipcRenderer.on('notch:update', (e, p) => cb(p)),
  // Open that provider's full panel (the card's expand icon).
  detach: (id) => ipcRenderer.send('notch:detach', id),
  contextMenu: () => ipcRenderer.send('notch:context-menu'),
  // Cards shown or not, and the window height they need.
  layout: (cards, needH) => ipcRenderer.send('notch:layout', cards, needH),
  // target 'notch' | 'card'; id is the provider for a card.
  pin: (target, id, on) => ipcRenderer.send('notch:pin', target, id, on),
  setSolid: (solid) => ipcRenderer.send('notch:solid', solid),
  drag: (phase, screenY, screenX) => ipcRenderer.send('notch:drag', phase, screenY, screenX),
});
