// PetWindow — owns the pet's BrowserWindow + position tracking against HUD +
// the per-pet StateMachine. Lifecycle:
//   - constructor: stash callbacks/config, do not open window yet
//   - attachHud(hudWindow): start tracking HUD position; debounced drag events
//     to StateMachine; recompute pet window position on every HUD move
//   - loadPet(pet): ensure window open, send pet data to renderer
//   - setAnchor(anchor): update anchor + reposition immediately
//   - updateUsage(data): forward to StateMachine
//   - close(): destroy window + tear down state machine

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const PetStateMachine = require('./PetStateMachine');

// Pet display at 0.4x of native 192x208 = 77x83.
// Window has extra horizontal buffer for bubble overflow + bubble area on top.
const PET_W = 77;
const PET_H = 83;
const BUBBLE_H = 40;
const SIDE_BUFFER = 32;
const WIN_W = PET_W + SIDE_BUFFER * 2;   // 141
const WIN_H = PET_H + BUBBLE_H;          // 123
const DRAG_DEBOUNCE_MS = 40;
const OVERLAP_PX = 2;                    // pet visual edge overlaps HUD edge by 2px
// Drag debounce intentionally short so the pet snaps back to baseline within
// ~100ms of the user releasing the HUD. Longer windows feel like "linger".
const DRAG_END_MS = 50;                  // no move event for this long = drag stopped

// Pet's visual rectangle inside the window (canvas is bottom-centered).
const PET_LEFT   = SIDE_BUFFER;                          // 32
const PET_RIGHT  = SIDE_BUFFER + PET_W;                  // 109
const PET_TOP    = BUBBLE_H;                             // 40
const PET_BOTTOM = BUBBLE_H + PET_H;                     // 123
const PET_HCENTER = (PET_LEFT + PET_RIGHT) / 2;          // 70.5
const PET_VCENTER = (PET_TOP + PET_BOTTOM) / 2;          // 81.5

const VALID_ANCHORS = ['TL','TC','LC','BL','BC','BR','RC'];

// Anchor model: bottom/top describes WHERE THE PET'S BASELINE SITS, not which
// half of the screen the pet floats in. The pet always stays beside the HUD
// (left/right side anchors) or directly above/below it (centre anchors), with
// 2px overlap into the HUD edge for a "leaning on" effect.
//
//   TL = pet on HUD's left  side, pet TOP aligned with HUD TOP
//   LC = pet on HUD's left  side, vertically centred on HUD
//   BL = pet on HUD's left  side, pet BOTTOM aligned with HUD BOTTOM
//   BC = pet directly BELOW HUD, horizontally centred
//   BR = pet on HUD's right side, pet BOTTOM aligned with HUD BOTTOM
//   RC = pet on HUD's right side, vertically centred on HUD
//   TC = pet directly ABOVE HUD, horizontally centred
//   (TR excluded — would collide with HUD's close X button)
function rawBoundsFor(hud, anchor) {
  let x, y;
  switch (anchor) {
    // Left-side anchors: pet visual right edge overlaps HUD left edge by 2px
    case 'TL':
      x = hud.x + OVERLAP_PX - PET_RIGHT;
      y = hud.y - PET_TOP;                                  // pet top = HUD top
      break;
    case 'LC':
      x = hud.x + OVERLAP_PX - PET_RIGHT;
      y = hud.y + hud.height / 2 - PET_VCENTER;
      break;
    case 'BL':
      x = hud.x + OVERLAP_PX - PET_RIGHT;
      y = hud.y + hud.height - PET_BOTTOM;                  // pet bottom = HUD bottom
      break;
    // Right-side anchors: pet visual left edge overlaps HUD right edge by 2px
    case 'BR':
      x = hud.x + hud.width - OVERLAP_PX - PET_LEFT;
      y = hud.y + hud.height - PET_BOTTOM;
      break;
    case 'RC':
      x = hud.x + hud.width - OVERLAP_PX - PET_LEFT;
      y = hud.y + hud.height / 2 - PET_VCENTER;
      break;
    // Above/below anchors: horizontally centred, pet edge meets HUD edge
    case 'TC':
      x = hud.x + hud.width / 2 - PET_HCENTER;
      y = hud.y + OVERLAP_PX - PET_BOTTOM;                  // pet bottom = HUD top
      break;
    case 'BC':
      x = hud.x + hud.width / 2 - PET_HCENTER;
      y = hud.y + hud.height - OVERLAP_PX - PET_TOP;        // pet top = HUD bottom
      break;
    default:
      x = hud.x + hud.width - OVERLAP_PX - PET_LEFT;
      y = hud.y + hud.height - PET_BOTTOM;
      break;
  }
  return { x, y };
}

function petVisualOnScreen(winX, winY) {
  return {
    left:   winX + PET_LEFT,
    right:  winX + PET_RIGHT,
    top:    winY + PET_TOP,
    bottom: winY + PET_BOTTOM,
  };
}

// Out-of-bounds along the side the anchor faces; clamping the opposite side is OK.
function isAnchorOutOfBounds(hud, anchor, wa) {
  const { x, y } = rawBoundsFor(hud, anchor);
  const pv = petVisualOnScreen(x, y);
  if (anchor === 'BR' || anchor === 'RC')               return pv.right  > wa.x + wa.width;
  if (anchor === 'BL' || anchor === 'TL' || anchor === 'LC') return pv.left   < wa.x;
  if (anchor === 'TC')                                  return pv.top    < wa.y;
  if (anchor === 'BC')                                  return pv.bottom > wa.y + wa.height;
  return false;
}

// Mirror anchor to the opposite side when off-screen. TR excluded → TL flips down to BL.
function flipAnchor(anchor) {
  switch (anchor) {
    case 'BR': return 'BL';
    case 'BL': return 'BR';
    case 'RC': return 'LC';
    case 'LC': return 'RC';
    case 'TL': return 'BL';     // no TR; flip down within left side
    case 'TC': return 'BC';
    case 'BC': return 'TC';
    default:   return 'BR';
  }
}

function computePetBounds(hud, anchor, screenWA) {
  let chosen = anchor;
  // Edge-adaptive: if requested anchor would push pet off-screen, flip once.
  if (screenWA && isAnchorOutOfBounds(hud, chosen, screenWA)) {
    const flipped = flipAnchor(chosen);
    if (!isAnchorOutOfBounds(hud, flipped, screenWA)) chosen = flipped;
  }
  let { x, y } = rawBoundsFor(hud, chosen);
  // Final safety clamp so window never lands fully off-screen (visible feedback
  // even if both anchor and its flip ran out of room).
  if (screenWA) {
    x = Math.max(screenWA.x, Math.min(screenWA.x + screenWA.width  - WIN_W, x));
    y = Math.max(screenWA.y, Math.min(screenWA.y + screenWA.height - WIN_H, y));
  }
  return { x: Math.round(x), y: Math.round(y), width: WIN_W, height: WIN_H };
}

class PetWindow {
  constructor({ anchor = 'BR' } = {}) {
    this.anchor = VALID_ANCHORS.includes(anchor) ? anchor : 'BR';
    this.window = null;
    this.hudWindow = null;
    this.pet = null;
    this._rendererReady = false;
    this._pendingPet = null;             // pet to send once renderer ready
    this._lastHudX = null;
    this._dragAccum = 0;
    this._dragDebounceTimer = null;
    this._dragEndTimer = null;

    this.stateMachine = new PetStateMachine({
      emitState: (s) => this._sendState(s),
      emitBubble: (b) => this._sendBubble(b),
    });

    this._wireIpc();
  }

  _wireIpc() {
    ipcMain.on('pet:ready', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this._rendererReady = true;
      if (this._pendingPet) {
        this._sendPet(this._pendingPet);
        this._pendingPet = null;
      }
    });
    ipcMain.on('pet:clicked', (e) => {
      if (!this.window || e.sender !== this.window.webContents) return;
      this.stateMachine.onPetClick();
    });
    ipcMain.on('pet:sprite-error', (e, id) => {
      console.warn('[pet] sprite failed to load for', id);
    });
  }

  _ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;
    this._rendererReady = false;

    const hudBounds = this.hudWindow ? this.hudWindow.getBounds() : { x: 100, y: 100, width: 0, height: 0 };
    const wa = screen.getDisplayMatching(hudBounds).workArea;
    const bounds = computePetBounds(hudBounds, this.anchor, wa);

    this.window = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
      x: bounds.x,
      y: bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      movable: false,             // user can't drag pet separately; it follows HUD
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'pet-preload.js'),
      },
    });

    this.window.setAlwaysOnTop(true, 'floating', 1);
    this.window.setVisibleOnAllWorkspaces(true);
    this.window.loadFile(path.join(__dirname, 'pet-renderer.html'));

    this.window.on('closed', () => {
      this.window = null;
      this._rendererReady = false;
    });

    this.stateMachine.start();
  }

  attachHud(hudWindow) {
    this.hudWindow = hudWindow;
    if (!hudWindow) return;

    // Track HUD movement → reposition pet + debounced drag direction → StateMachine
    hudWindow.on('move', () => {
      if (!this.hudWindow || this.hudWindow.isDestroyed()) return;
      const b = this.hudWindow.getBounds();

      if (this._lastHudX !== null) {
        this._dragAccum += b.x - this._lastHudX;
        if (!this._dragDebounceTimer) {
          this._dragDebounceTimer = setTimeout(() => {
            const total = this._dragAccum;
            this._dragAccum = 0;
            this._dragDebounceTimer = null;
            if (Math.abs(total) >= 2) {     // ignore single-pixel jitter
              this.stateMachine.onDrag(total);
            }
          }, DRAG_DEBOUNCE_MS);
        }
      }
      this._lastHudX = b.x;

      this._reposition();

      // Drag-end detection: if no move event arrives within DRAG_END_MS, the
      // user released the HUD. Force StateMachine out of drag state so the
      // pet snaps back to baseline with zero linger — DRAG_HOLD_MS alone
      // can't go arbitrarily low without breaking continuous-drag holding.
      if (this._dragEndTimer) clearTimeout(this._dragEndTimer);
      this._dragEndTimer = setTimeout(() => {
        this._dragEndTimer = null;
        this.stateMachine.onDragEnd();
      }, DRAG_END_MS);
    });
  }

  setAnchor(anchor) {
    if (!VALID_ANCHORS.includes(anchor)) return;
    this.anchor = anchor;
    this._reposition();
  }

  _reposition() {
    if (!this.window || this.window.isDestroyed() || !this.hudWindow) return;
    const hudBounds = this.hudWindow.getBounds();
    const display = screen.getDisplayMatching(hudBounds);
    const bounds = computePetBounds(hudBounds, this.anchor, display.workArea);

    // Electron transparent windows on macOS lose their transparent backing
    // when moved between displays (known issue). If the HUD has crossed to a
    // new display, recreate the pet window so it's re-born on the new display
    // with a fresh transparent compositor — saves the pet from showing a
    // solid white window backing on the secondary screen.
    if (this._lastDisplayId !== undefined && display.id !== this._lastDisplayId) {
      this._lastDisplayId = display.id;
      if (this.pet) {
        const savedPet = this.pet;
        if (this.window && !this.window.isDestroyed()) this.window.close();
        this.window = null;
        this._rendererReady = false;
        this._pendingPet = null;
        // Stop & restart state machine to clear any in-flight timers tied to
        // the closing window's renderer.
        this.stateMachine.stop();
        this.pet = null;
        this.loadPet(savedPet);          // ensures window with new bounds
        this.stateMachine.start();
        return;
      }
    }
    this._lastDisplayId = display.id;

    this.window.setBounds(bounds);
  }

  loadPet(pet) {
    this.pet = pet;
    this._ensureWindow();
    if (this._rendererReady) {
      this._sendPet(pet);
    } else {
      this._pendingPet = pet;        // renderer 'pet:ready' will flush this
    }
  }

  // Hide the pet window + stop state machine. Reversible: next loadPet()
  // recreates the window. Used when user toggles active pet off in library.
  hide() {
    this.stateMachine.stop();
    if (this._dragDebounceTimer) {
      clearTimeout(this._dragDebounceTimer);
      this._dragDebounceTimer = null;
      this._dragAccum = 0;
    }
    if (this._dragEndTimer) {
      clearTimeout(this._dragEndTimer);
      this._dragEndTimer = null;
    }
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this._rendererReady = false;
    this._pendingPet = null;
    this.pet = null;
  }

  updateUsage(data) {
    this.stateMachine.onUsageUpdate(data);
  }

  _sendPet(pet) {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('pet:load', pet);
  }
  _sendState(state) {
    if (!this.window || this.window.isDestroyed() || !this._rendererReady) return;
    this.window.webContents.send('pet:state', state);
  }
  _sendBubble(b) {
    if (!this.window || this.window.isDestroyed() || !this._rendererReady) return;
    this.window.webContents.send('pet:bubble', b);
  }

  close() {
    this.stateMachine.stop();
    if (this._dragDebounceTimer) clearTimeout(this._dragDebounceTimer);
    if (this.window && !this.window.isDestroyed()) this.window.close();
    this.window = null;
    this.hudWindow = null;
  }
}

module.exports = PetWindow;
module.exports.VALID_ANCHORS = VALID_ANCHORS;
