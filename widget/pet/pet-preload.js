// pet-preload.js — exposes petAPI to the pet renderer process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  rendererReady: () => ipcRenderer.send('pet:ready'),
  clicked: () => ipcRenderer.send('pet:clicked'),
  spriteLoadFailed: (petId) => ipcRenderer.send('pet:sprite-error', petId),
  onPetLoad: (cb) => ipcRenderer.on('pet:load', (e, pet) => cb(pet)),
  onStateChange: (cb) => ipcRenderer.on('pet:state', (e, state) => cb(state)),
  onBubble: (cb) => ipcRenderer.on('pet:bubble', (e, b) => cb(b)),
});
