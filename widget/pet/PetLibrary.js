// PetLibrary — manages the user's installed pets + the popover UI window.
//
// Responsibilities:
//   - Scan petsRoot to enumerate installed pets (up to SLOT_CAP soft limit)
//   - Spawn the popover BrowserWindow on demand, anchored next to HUD,
//     edge-adaptive (flip side if it would overflow screen)
//   - Handle import (file dialog → adapter.install)
//   - Handle activate (notify owner via callback) and remove (delete folder)
//
// State is pushed to renderer as { pets: [...], activeId } whenever it changes.

const { BrowserWindow, ipcMain, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const codexAdapter = require('./CodexPetAdapter');

const SLOT_CAP = 6;
const POPOVER_W = 280;
const POPOVER_H = 200;
const POPOVER_GAP = 8;          // gap between HUD and popover

function listInstalledPets(petsRoot) {
  if (!fs.existsSync(petsRoot)) return [];
  return fs.readdirSync(petsRoot)
    .filter((name) => !name.startsWith('.'))
    .map((name) => {
      const dir = path.join(petsRoot, name);
      if (!fs.statSync(dir).isDirectory()) return null;
      try { return codexAdapter.loadInstalled(dir); }
      catch (e) { console.warn('[library] skip', name, e.message); return null; }
    })
    .filter(Boolean);
}

function computePopoverBounds(hud, preferLeft, wa) {
  // Vertically center on HUD, clamped to the work area.
  const yCenter = hud.y + (hud.height - POPOVER_H) / 2;
  const yClamped = Math.max(wa.y, Math.min(wa.y + wa.height - POPOVER_H, yCenter));
  const xLeft  = hud.x - POPOVER_W - POPOVER_GAP;
  const xRight = hud.x + hud.width + POPOVER_GAP;
  let x;
  if (preferLeft) {
    x = xLeft >= wa.x ? xLeft : xRight;
  } else {
    x = (xRight + POPOVER_W <= wa.x + wa.width) ? xRight : xLeft;
  }
  return {
    x: Math.round(x),
    y: Math.round(yClamped),
    width: POPOVER_W,
    height: POPOVER_H,
  };
}

class PetLibrary {
  constructor({ petsRoot, onActivePetChange }) {
    this.petsRoot = petsRoot;
    this.onActivePetChange = onActivePetChange;
    this.activeId = null;
    this.window = null;
    this.preferLeft = true;            // default: open to HUD's left side
    this.hudWindow = null;
    this._wireIpc();
  }

  setHudWindow(hudWindow) { this.hudWindow = hudWindow; }
  setActiveId(petId) { this.activeId = petId; this._pushState(); }
  setPreferLeft(bool) { this.preferLeft = bool; }
  // Optional: if set, library opens on whichever side the pet button is on
  // (matches button's auto-flip behavior so the popover lands next to the
  // affordance the user just clicked).
  setPetButton(petButton) { this.petButton = petButton; }

  listPets() {
    return listInstalledPets(this.petsRoot);
  }

  // Toggle the popover. Returns true if now visible.
  toggle() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      return false;
    }
    this._openWindow();
    return true;
  }

  _openWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    const hudBounds = this.hudWindow ? this.hudWindow.getBounds() : { x: 100, y: 100, width: 0, height: 0 };
    const wa = screen.getDisplayMatching(hudBounds).workArea;
    // If we have a button reference, follow whichever side the button is on
    // right now (it may have auto-flipped due to HUD being near a screen edge).
    let preferLeft = this.preferLeft;
    if (this.petButton) {
      const btnBounds = this.petButton.getBounds();
      if (btnBounds) {
        const btnCenter = btnBounds.x + btnBounds.width / 2;
        const hudCenter = hudBounds.x + hudBounds.width / 2;
        preferLeft = btnCenter < hudCenter;
      }
    }
    const bounds = computePopoverBounds(hudBounds, preferLeft, wa);

    this.window = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'library-preload.js'),
      },
    });

    this.window.setAlwaysOnTop(true, 'floating', 1);
    this.window.loadFile(path.join(__dirname, 'library-renderer.html'));

    // Auto-close when user clicks outside
    this.window.on('blur', () => {
      if (this.window && !this.window.isDestroyed()) this.window.close();
    });
    this.window.on('closed', () => { this.window = null; });
  }

  _pushState() {
    if (!this.window || this.window.isDestroyed()) return;
    const pets = this.listPets();
    this.window.webContents.send('library:state', { pets, activeId: this.activeId });
  }

  async _import() {
    const existing = this.listPets();
    if (existing.length >= SLOT_CAP) {
      dialog.showMessageBox(this.window || undefined, {
        type: 'info',
        message: 'Library full',
        detail: `You can store up to ${SLOT_CAP} pets. Remove one first to import another.`,
      });
      return;
    }
    const res = await dialog.showOpenDialog(this.window || undefined, {
      title: 'Choose a Codex pet package',
      filters: [{ name: 'Codex pet', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return;
    try {
      await codexAdapter.install(res.filePaths[0], this.petsRoot);
      this._pushState();
    } catch (e) {
      dialog.showMessageBox(this.window || undefined, {
        type: 'error',
        message: 'Import failed',
        detail: e.message,
      });
    }
  }

  async _remove(petId) {
    const dir = path.join(this.petsRoot, petId);
    if (!fs.existsSync(dir)) return;
    const res = await dialog.showMessageBox(this.window || undefined, {
      type: 'warning',
      message: `Remove "${petId}"?`,
      buttons: ['Cancel', 'Remove'],
      defaultId: 0,
      cancelId: 0,
    });
    if (res.response !== 1) return;
    fs.rmSync(dir, { recursive: true, force: true });
    if (this.activeId === petId) {
      this.activeId = null;
      this.onActivePetChange && this.onActivePetChange(null);
    }
    this._pushState();
  }

  _wireIpc() {
    ipcMain.on('library:ready', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this._pushState();
    });
    ipcMain.on('library:import', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this._import();
    });
    ipcMain.on('library:activate', (e, petId) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this.activeId = petId;
      this.onActivePetChange && this.onActivePetChange(petId);
      this._pushState();
    });
    ipcMain.on('library:remove', (e, petId) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this._remove(petId);
    });
    ipcMain.on('library:close', (e) => {
      if (this.window && !this.window.isDestroyed() && e.sender === this.window.webContents) {
        this.window.close();
      }
    });
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }
}

module.exports = PetLibrary;
module.exports.SLOT_CAP = SLOT_CAP;
