// PetButton — small always-visible BrowserWindow anchored to HUD's left side
// (outside the HUD card). Click opens the pet library. Shows active pet's first
// idle frame as preview, or a "+" placeholder when no pet is active.

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

const BTN_W = 36;
const BTN_H = 36;
const HUD_GAP = 6;   // gap between HUD and button

function computeButtonBounds(hud, wa) {
  // Default: button sits to the LEFT of HUD, vertically centered.
  let x = hud.x - BTN_W - HUD_GAP;
  let y = hud.y + Math.round((hud.height - BTN_H) / 2);

  // Edge-adapt: if button would go off-screen-left, place on RIGHT side of HUD.
  if (x < wa.x + 4) {
    x = hud.x + hud.width + HUD_GAP;
  }
  // Clamp y to screen
  y = Math.max(wa.y, Math.min(wa.y + wa.height - BTN_H, y));
  return { x: Math.round(x), y: Math.round(y), width: BTN_W, height: BTN_H };
}

class PetButton {
  constructor({ onClick }) {
    this.onClick = onClick;
    this.window = null;
    this.hudWindow = null;
    this._rendererReady = false;
    this._pendingActivePet = null;
    this._pendingHover = false;        // start hidden
    this._hideTimer = null;
    this._wireIpc();
  }

  _wireIpc() {
    ipcMain.on('button:ready', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this._rendererReady = true;
      this._sendActivePet(this._pendingActivePet);
      this._sendHover(this._pendingHover);    // flush cached hover state
    });
    ipcMain.on('button:click', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      if (this.onClick) this.onClick();
    });
  }

  _ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    this._rendererReady = false;

    const hudBounds = this.hudWindow ? this.hudWindow.getBounds() : { x: 100, y: 100, width: 0, height: 0 };
    const wa = screen.getDisplayMatching(hudBounds).workArea;
    const bounds = computeButtonBounds(hudBounds, wa);

    this.window = new BrowserWindow({
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',     // Electron defaults to #FFF; must override
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'button-preload.js'),
      },
    });

    this.window.setAlwaysOnTop(true, 'floating', 1);
    this.window.setVisibleOnAllWorkspaces(true);
    // Start fully hidden at window level. Any default white backing from
    // Electron/macOS is killed by window opacity 0 regardless of CSS state.
    // setHovered() lifts opacity to 1 when cursor enters the hover zone.
    this.window.setOpacity(0);
    this.window.loadFile(path.join(__dirname, 'button-renderer.html'));

    // Track birth display for drag-end debounced display-change recreate.
    this._stableDisplayId = screen.getDisplayMatching(hudBounds).id;

    this.window.on('closed', () => {
      this.window = null;
      this._rendererReady = false;
    });
  }

  attachHud(hudWindow) {
    this.hudWindow = hudWindow;
    this._ensureWindow();
    if (!hudWindow) return;
    hudWindow.on('move', () => {
      this._reposition();
      // Drag-end debounced display-change recreate (single-shot).
      if (this._dragEndTimer) clearTimeout(this._dragEndTimer);
      this._dragEndTimer = setTimeout(() => {
        this._dragEndTimer = null;
        this._maybeRecreateForNewDisplay();
      }, 80);
    });
    hudWindow.on('resize', () => this._reposition());
  }

  _reposition() {
    if (!this.window || this.window.isDestroyed() || !this.hudWindow) return;
    const hudBounds = this.hudWindow.getBounds();
    const display = screen.getDisplayMatching(hudBounds);
    this.window.setBounds(computeButtonBounds(hudBounds, display.workArea));
  }

  // Same drag-end debounced destroy+respawn as PetWindow for the Mac
  // multi-display transparent-backing bug.
  _maybeRecreateForNewDisplay() {
    if (!this.window || this.window.isDestroyed() || !this.hudWindow || this.hudWindow.isDestroyed()) return;
    const displayId = screen.getDisplayMatching(this.hudWindow.getBounds()).id;
    if (this._stableDisplayId === displayId) return;
    this._stableDisplayId = displayId;
    const savedHover = this._pendingHover;
    const savedPet = this._pendingActivePet;
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }
    this.window.destroy();
    this.window = null;
    this._rendererReady = false;
    setTimeout(() => {
      this._ensureWindow();
      this._pendingHover = savedHover;
      this._pendingActivePet = savedPet;
      // Renderer's 'button:ready' will flush both pending states.
    }, 30);
  }

  setActivePet(pet) {
    // pet is the same shape as sent to HUD: { id, displayName, spritesheetPath, ... } or null
    this._pendingActivePet = pet;
    if (this._rendererReady) this._sendActivePet(pet);
  }

  // Called by main process cursor-tracker. `true` = cursor over hover zone.
  // Toggles BOTH (a) window opacity (kills any backing leak) and (b) CSS reveal
  // class (drives the scale+fade animation). Window opacity flips to 1
  // immediately on show; on hide we wait for the CSS fade-out to complete
  // before snapping opacity to 0.
  setHovered(over) {
    this._pendingHover = !!over;
    if (this._rendererReady) this._sendHover(this._pendingHover);

    if (!this.window || this.window.isDestroyed()) return;
    if (this._hideTimer) { clearTimeout(this._hideTimer); this._hideTimer = null; }

    if (over) {
      this.window.setOpacity(1);
    } else {
      this._hideTimer = setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) this.window.setOpacity(0);
        this._hideTimer = null;
      }, 350);    // longer than CSS transition (280ms) so animation finishes first
    }
  }

  _sendHover(over) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('button:hover', !!over);
  }

  getBounds() {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.getBounds();
  }

  // Hover trigger zone: a strip along the HUD edge on the side where the button
  // sits, plus the button itself. Cursor inside HUD body should NOT reveal the
  // button — only hovering near the edge does.
  getHoverZone(hud) {
    const b = this.getBounds();
    if (!b || !hud) return null;
    const buttonIsLeft = (b.x + b.width) <= hud.x;
    const stripWidth = b.width;
    return {
      x: buttonIsLeft ? (hud.x - stripWidth) : (hud.x + hud.width),
      y: hud.y,
      width: stripWidth,
      height: hud.height,
    };
  }

  _sendActivePet(pet) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('button:active-pet', pet);
  }

  close() {
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
  }
}

module.exports = PetButton;
