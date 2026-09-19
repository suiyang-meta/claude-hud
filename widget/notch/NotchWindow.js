'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * NotchWindow — the HUD's resting form: a small dark tab on the edge of the
 * screen.
 *
 * Three states, each one step further from "out of the way":
 *   folded  a sliver hugging the edge; two hairline meters, nothing to read
 *   open    cursor on the sliver: the notch slides out with one ring per
 *           provider (Claude, Codex); a ring shows its detail card on hover
 *   panel   click a ring: that provider's own panel opens beside the notch,
 *           which folds back to the sliver so the other ring stays reachable
 *
 * Either state can be pinned: the notch (stays open) and each card (stays
 * beside its ring). It docks on the right or left edge; drag it across the
 * middle of the screen to switch.
 *
 * The window is resized for each state rather than kept large and transparent,
 * because a transparent region of a window still swallows clicks on macOS —
 * a big invisible notch window would eat clicks meant for whatever is under it.
 */
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

// Geometry, in px. Keep in step with GEO/PHI in notch.html. Each flare off the
// screen edge is two r=24 bends (60° each) joined by a straight slope, and ends
// at FLARE_Y — the convex bend's centre, which is also the first ring's centre
// (24 = ring radius 14.5 + padding 9.5). The bottom bend is centred on the last
// ring's percentage label.
const FOLD_W = 9,  FOLD_H = 64;
const OPEN_W = 48, BEND_R = 24, PHI = Math.PI / 3;
const FLARE_Y = 2 * BEND_R * Math.sin(PHI)
              + Math.cos(PHI) * (OPEN_W - 2 * BEND_R * (1 - Math.cos(PHI))) / Math.sin(PHI);
const ROW_H = 50, LABEL_DROP = 24;   // ring centre -> percentage label centre
const CARD_W = 236;                 // extra width beside the notch while cards show
const FOLD_DELAY = 380;             // ms the cursor may stray before it folds

class NotchWindow {
  /**
   * @param {object} o
   * @param {object} o.prefs   { centerY, side: 'right'|'left', pinned, cards: [ids] }
   * @param {(p:object)=>void} o.onPrefs   persist position / side / pins
   * @param {(id:string)=>void} o.onActivate   the user clicked a ring or card
   * @param {()=>void} o.onContextMenu
   */
  constructor({ prefs = {}, onPrefs, onActivate, onContextMenu }) {
    this.centerY = typeof prefs.centerY === 'number' ? prefs.centerY : null;
    this.side = prefs.side === 'left' ? 'left' : 'right';
    this.pinned = !!prefs.pinned;
    this.pinnedCards = Array.isArray(prefs.cards) ? prefs.cards.slice() : [];
    this.onPrefs = onPrefs;
    this.onActivate = onActivate;
    this.onContextMenu = onContextMenu;
    this.state = 'folded';           // 'folded' | 'open' | 'hidden'
    this.rows = 1;
    this.cardsShown = false;
    this.cardsNeedH = 0;
    this.solid = true;               // false = clicks pass through to what is underneath
    this.dragging = false;
    this.lastPayload = null;
    this._outsideSince = 0;
    this._create();
    this._wireIpc();
    this._poll = setInterval(() => this._tick(), 60);
  }

  _create() {
    this.window = new BrowserWindow({
      ...this._bounds('folded'),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      movable: false,          // dragging is ours; the OS must not move it freely
      skipTaskbar: true,
      hasShadow: false,
      focusable: false,        // never steal focus from what the user is typing in
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'notch-preload.js'),
      },
    });
    this.window.setAlwaysOnTop(true, 'floating', 1);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // Most of this window is transparent at any moment, so it starts click-
    // through; the page turns clicks back on while the pointer is over
    // something it drew (the notch, a ring, a card).
    this._setSolid(false);
    this.window.loadFile(path.join(__dirname, 'notch.html'));
    this.window.once('ready-to-show', () => {
      if (this.state !== 'hidden') this.window.showInactive();
    });
    this.window.webContents.on('did-finish-load', () => {
      this._sendState();
      if (this.lastPayload) this._send('notch:update', this.lastPayload);
    });
  }

  _wireIpc() {
    const mine = (e) => this.window && !this.window.isDestroyed()
                        && e.sender === this.window.webContents;
    // The card's expand icon: that card leaves the notch and becomes a panel.
    ipcMain.on('notch:detach', (e, id) => {
      if (!mine(e)) return;
      this.detach(id);
      if (this.onActivate) this.onActivate(id);
    });
    ipcMain.on('notch:context-menu', (e) => { if (mine(e)) this.onContextMenu && this.onContextMenu(); });
    ipcMain.on('notch:layout', (e, cards, needH) => {
      if (!mine(e)) return;
      this.cardsShown = !!cards && this.state === 'open';
      this.cardsNeedH = Math.max(0, Math.round(needH || 0));
      this._apply();
    });
    ipcMain.on('notch:pin', (e, target, id, on) => {
      if (!mine(e)) return;
      if (target === 'notch') this.setPinned(!!on);
      else if (target === 'card' && id) this.setCardPinned(id, !!on);
    });
    ipcMain.on('notch:solid', (e, solid) => {
      if (!mine(e)) return;
      this._setSolid(!!solid);
    });
    ipcMain.on('notch:drag', (e, phase, screenY, screenX) => {
      if (!mine(e)) return;
      if (phase === 'start') {
        this.dragging = true; this._dragStartY = screenY; this._dragStartCenter = this._center();
        return;
      }
      if (phase === 'move' && this.dragging) {
        this.centerY = this._clampCenter(this._dragStartCenter + (screenY - this._dragStartY));
        // Dragged past the middle of the screen: move to the other edge.
        const wa = this._wa();
        const side = screenX < wa.x + wa.width / 2 ? 'left' : 'right';
        if (side !== this.side) { this.side = side; this._sendState(); }
        this._apply();
        return;
      }
      if (phase === 'end') {
        this.dragging = false;
        this._savePrefs();
      }
    });
  }

  _savePrefs() {
    if (this.onPrefs) this.onPrefs({ centerY: this.centerY, side: this.side,
                                     pinned: this.pinned, cards: this.pinnedCards.slice() });
  }

  _wa() { return screen.getPrimaryDisplay().workArea; }

  _notchH() { return Math.round(2 * FLARE_Y + (this.rows - 1) * ROW_H + LABEL_DROP); }

  /* One size for every state: room for the open notch and every card. Folding
     and unfolding are then animations inside a still window. Resizing it —
     per state, or per hovered card — is what made the notch flash a frame of
     its old shape and jump under the pointer. The empty part is click-through. */
  _size() {
    return { w: OPEN_W + CARD_W, h: Math.max(this._notchH(), this.cardsNeedH, FOLD_H) };
  }

  /** The folded sliver, in screen coordinates. */
  _foldRect() {
    const wa = this._wa(), c = this._clampCenter(this._center());
    const x = this.side === 'left' ? wa.x : wa.x + wa.width - FOLD_W;
    return { x, y: Math.round(c - FOLD_H / 2), width: FOLD_W, height: FOLD_H };
  }

  _center() {
    const wa = this._wa();
    return this.centerY == null ? wa.y + Math.round(wa.height * 0.24) : this.centerY;
  }

  _clampCenter(c) {
    const wa = this._wa();
    // Clamp against the notch's open height so opening never pushes it off-screen.
    const half = Math.ceil(this._notchH() / 2);
    return Math.max(wa.y + half, Math.min(wa.y + wa.height - half, Math.round(c)));
  }

  _bounds(state) {
    const wa = this._wa();
    const { w, h } = this._size(state);
    const c = this._clampCenter(this._center());
    const x = this.side === 'left' ? wa.x : wa.x + wa.width - w;
    return { x, y: Math.round(c - h / 2), width: w, height: h };
  }

  _apply() {
    if (!this.window || this.window.isDestroyed() || this.state === 'hidden') return;
    this.window.setBounds(this._bounds(this.state));
  }

  _send(ch, v) {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send(ch, v);
  }

  _sendState() {
    if (!this.window || this.window.isDestroyed()) return;
    this._send('notch:state', { state: this.state, side: this.side,
                                pinned: this.pinned, cards: this.pinnedCards.slice() });
  }

  _setSolid(solid) {
    if (solid === this.solid || !this.window || this.window.isDestroyed()) return;
    this.solid = solid;
    // forward: keep delivering mouse moves, so the page can tell us when the
    // pointer comes back over something it drew.
    this.window.setIgnoreMouseEvents(!solid, { forward: true });
  }

  isPinned() { return this.pinned || this.pinnedCards.length > 0; }

  _setState(next) {
    if (next === this.state) return;
    const prev = this.state;
    this.state = next;
    if (next === 'open') {
      this._sendState();
    } else if (next === 'folded') {
      this.cardsShown = false;
      this._sendState();
      if (prev === 'hidden') { this._apply(); this.window.showInactive(); }
    } else if (next === 'hidden') {
      this.cardsShown = false;
      this.window.hide();
    }
  }

  _tick() {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.state === 'hidden' || this.dragging) { this._outsideSince = 0; return; }
    const p = screen.getCursorScreenPoint();
    const b = this.window.getBounds();
    const wa = this._wa();
    if (this.state === 'folded') {
      if (this.isPinned()) { this._setState('open'); return; }
      // The sliver is thin; accept the whole strip out to the screen edge,
      // plus a little slack above and below, so it is easy to hit. Tested
      // against the folded geometry, not the window, which is still open-sized
      // for the length of the fold animation.
      const f = this._foldRect();
      const hitX = this.side === 'left'
        ? p.x >= wa.x && p.x <= f.x + f.width + 2
        : p.x >= f.x - 2 && p.x <= wa.x + wa.width;
      const hit = hitX && p.y >= f.y - 6 && p.y <= f.y + f.height + 6;
      // After a click folds it, the pointer is often still resting on the edge;
      // wait for it to leave once before hover may open the notch again.
      if (this._holdUntilLeave) { if (!hit) this._holdUntilLeave = false; return; }
      if (hit) this._setState('open');
      return;
    }
    if (this.isPinned()) { this._outsideSince = 0; return; }   // pinned: never folds
    // "Inside" is the notch itself, plus the card column only while a card is
    // showing — the window is wider than both, and its empty part must not
    // hold the notch open.
    const nh = this._notchH(), cy = b.y + b.height / 2;
    const nx = this.side === 'left' ? b.x : b.x + b.width - OPEN_W;
    const inNotch = p.x >= nx && p.x <= nx + OPEN_W && p.y >= cy - nh / 2 && p.y <= cy + nh / 2;
    const inWindow = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    if (inNotch || (this.cardsShown && inWindow)) { this._outsideSince = 0; return; }
    if (!this._outsideSince) this._outsideSince = Date.now();
    else if (Date.now() - this._outsideSince > FOLD_DELAY) {
      this._outsideSince = 0;
      this._setState('folded');
    }
  }

  /** @param {{providers: Array}} payload */
  update(payload) {
    this.lastPayload = payload;
    const rows = Math.max(1, (payload.providers || []).length);
    if (rows !== this.rows) { this.rows = rows; this._apply(); }
    this._send('notch:update', payload);
  }

  /** Pinning the notch keeps it open. Unpinning it lets go of the cards too,
   *  since a card hangs off its ring and cannot outlive it. */
  setPinned(on) {
    this.pinned = on;
    if (!on) this.pinnedCards = [];
    this._afterPinChange();
  }

  /** A pinned card implies an open notch, so it pins that too. */
  setCardPinned(id, on) {
    this.pinnedCards = this.pinnedCards.filter((c) => c !== id);
    if (on) { this.pinnedCards.push(id); this.pinned = true; }
    this._afterPinChange();
  }

  setSide(side) {
    this.side = side === 'left' ? 'left' : 'right';
    this._apply();
    this._sendState();
    this._savePrefs();
  }

  _afterPinChange() {
    this._savePrefs();
    this._sendState();
    if (this.isPinned() && this.state === 'folded') this._setState('open');
  }

  /** A card left the notch as a full panel: it is no longer pinned here, and
   *  if it was the only thing holding the notch open, the notch folds away. */
  detach(id) {
    this.pinnedCards = this.pinnedCards.filter((c) => c !== id);
    if (!this.pinnedCards.length) this.pinned = false;
    this._savePrefs();
    this._sendState();
  }

  fold() {
    if (this.state !== 'open' || this.isPinned()) return;
    this._holdUntilLeave = true;
    this._setState('folded');
  }
  hide() { this._setState('hidden'); }
  show() { this._setState('folded'); }
  isHidden() { return this.state === 'hidden'; }

  /** Where a panel should open: beside the notch, on the screen side of it,
   *  clear of it even when it is open. */
  anchorFor(panelW, panelH) {
    const wa = this._wa();
    const top = this._center() - 60;
    return {
      x: this.side === 'left' ? wa.x + OPEN_W + 12 : wa.x + wa.width - OPEN_W - panelW - 12,
      y: Math.max(wa.y + 8, Math.min(wa.y + wa.height - panelH - 8, Math.round(top))),
    };
  }

  /** Displays change (monitor unplugged, resolution): re-seat on the edge. */
  reseat() { this._apply(); }
}

module.exports = NotchWindow;
