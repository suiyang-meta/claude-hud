// library-preload.js — exposes libraryAPI to the library popover renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('libraryAPI', {
  ready: () => ipcRenderer.send('library:ready'),
  importSlot: () => ipcRenderer.send('library:import'),
  activate: (petId) => ipcRenderer.send('library:activate', petId),
  remove: (petId) => ipcRenderer.send('library:remove', petId),
  close: () => ipcRenderer.send('library:close'),
  onState: (cb) => ipcRenderer.on('library:state', (e, s) => cb(s)),
});
