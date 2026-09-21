/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
const { app, BrowserWindow, dialog, ipcMain, powerMonitor, screen, Menu, shell } = require('electron');

const IS_MAC = process.platform === 'darwin';

// Attribution. Kept as one constant so every surface that names the project —
// the panel footer, the context menu, the macOS about panel — cannot drift apart.
const REPO_URL = 'https://github.com/suiyang-meta/claude-hud';
const AUTHOR = 'Sui1491';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const WebSocket = require('ws');
const PetWindow = require('./pet/PetWindow');
const PetLibrary = require('./pet/PetLibrary');
const PetButton = require('./pet/PetButton');
const codexAdapter = require('./pet/CodexPetAdapter');
const OAuthUsage = require('./usage/OAuthUsage');
const CodexUsage = require('./usage/CodexUsage');
const NotchWindow = require('./notch/NotchWindow');
const { LocalUsageScanner } = require('./usage/LocalUsage');

let mainWindow;
// Quota now comes from Claude Code's own OAuth credential; the extension
// WebSocket is kept only as a fallback for when that read fails.
let usageState = { quota: null, local: null, profile: null, quotaStale: false,
                   codex: null, codexStale: false, codexNote: null };
let extensionData = null;
let scanner;

// Fade uses the WINDOW's opacity, not CSS. Lowering CSS opacity over a vibrancy
// window just lets the blur layer show through, which reads as "washed out
// white" rather than transparent.
const OPACITY_IDLE = 0.60;
const OPACITY_FULL = 1.0;
let opacityLocked = false;
let opacityCurrent = OPACITY_IDLE;
let opacityTarget = OPACITY_IDLE;
let opacityTimer = null;

function easeOpacityTo(target) {
  opacityTarget = target;
  if (opacityTimer) return;
  opacityTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(opacityTimer); opacityTimer = null; return;
    }
    const delta = opacityTarget - opacityCurrent;
    if (Math.abs(delta) < 0.008) {
      opacityCurrent = opacityTarget;
      mainWindow.setOpacity(opacityCurrent);
      clearInterval(opacityTimer); opacityTimer = null;
      return;
    }
    opacityCurrent += delta * 0.2;
    mainWindow.setOpacity(opacityCurrent);
  }, 16);
}

function refreshOpacity() {
  easeOpacityTo((opacityLocked || isHovered) ? OPACITY_FULL : OPACITY_IDLE);
}
let wss;
let isHovered = false;

let notch;
let panelVisible = false;
let codexWindow = null;       // Codex's own panel, created on first open

let petWindow;
let petLibrary;
let petButton;
const PETS_ROOT = path.join(app.getPath('userData'), 'pets');
const DEFAULT_PET_DIR = path.join(__dirname, 'assets', 'default-pet');
const DEFAULT_PET_ID = 'claw-d';

// ---- Preferences (persisted across launches) ----
const PREFS_PATH = path.join(app.getPath('userData'), 'prefs.json');

function loadPrefs() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    }
  } catch (e) {
    console.log('[HUD for Claude] Failed to read prefs:', e.message);
  }
  // First launch defaults: auto-start ON
  return { openAtLogin: true, firstLaunch: true };
}

function savePrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch (e) {
    console.log('[HUD for Claude] Failed to save prefs:', e.message);
  }
}

function applyAutoStart(enabled) {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: false
  });
}

function isAutoStartEnabled() {
  return loadPrefs().openAtLogin !== false;
}

// ---- Pet bootstrap ----
function ensureDefaultPetInstalled() {
  if (!fs.existsSync(PETS_ROOT)) fs.mkdirSync(PETS_ROOT, { recursive: true });
  const olaDir = path.join(PETS_ROOT, DEFAULT_PET_ID);
  if (fs.existsSync(path.join(olaDir, 'pet.json'))) return;
  const manifestSrc = path.join(DEFAULT_PET_DIR, 'pet.json');
  if (!fs.existsSync(manifestSrc)) return;   // dev: bundled default not present yet
  fs.mkdirSync(olaDir, { recursive: true });
  for (const f of fs.readdirSync(DEFAULT_PET_DIR)) {
    fs.copyFileSync(path.join(DEFAULT_PET_DIR, f), path.join(olaDir, f));
  }
}

function broadcastActivePet(pet) {
  const payload = pet ? {
    id: pet.id,
    displayName: pet.displayName,
    spritesheetPath: pet.spritesheetPath,
    frameWidth: pet.frameWidth,
    frameHeight: pet.frameHeight,
  } : null;
  if (petButton) petButton.setActivePet(payload);
}

function setActivePet(petId) {
  const prefs = loadPrefs();
  prefs.pet = prefs.pet || {};
  prefs.pet.activeId = petId || null;
  savePrefs(prefs);
  if (petLibrary) petLibrary.setActiveId(petId || null);
  if (!petId) {
    if (petWindow) petWindow.hide();
    broadcastActivePet(null);
    return;
  }
  try {
    const pet = codexAdapter.loadInstalled(path.join(PETS_ROOT, petId));
    if (petWindow) petWindow.loadPet(pet);
    broadcastActivePet(pet);
  } catch (e) {
    console.log('[pet] activate failed:', e.message);
  }
}

function initPet() {
  ensureDefaultPetInstalled();
  const prefs = loadPrefs();
  prefs.pet = prefs.pet || {};
  const anchor = prefs.pet.anchor || 'BR';
  const libraryPreferLeft = prefs.pet.libraryPreferLeft !== false;
  let activeId = prefs.pet.activeId || null;
  // Stale pointer guard: older prefs may reference a pet id whose folder no
  // longer exists (e.g. the previous default was renamed). Fall back to the
  // bundled default so users don't end up with no active pet after upgrade.
  if (activeId && !fs.existsSync(path.join(PETS_ROOT, activeId, 'pet.json'))) {
    activeId = null;
  }
  if (!activeId && fs.existsSync(path.join(PETS_ROOT, DEFAULT_PET_ID, 'pet.json'))) {
    activeId = DEFAULT_PET_ID;
  }

  petLibrary = new PetLibrary({
    petsRoot: PETS_ROOT,
    onActivePetChange: (newId) => setActivePet(newId),
  });
  petLibrary.setHudWindow(mainWindow);
  petLibrary.setPreferLeft(libraryPreferLeft);

  // Both start hidden: they follow the panel, and the panel starts folded.
  petWindow = new PetWindow({ anchor });
  petWindow.setVisible(panelVisible);
  petWindow.attachHud(mainWindow);

  petButton = new PetButton({
    onClick: () => { if (petLibrary) petLibrary.toggle(); },
  });
  petButton.setVisible(panelVisible);
  petButton.attachHud(mainWindow);
  petLibrary.setPetButton(petButton);   // library opens on button's current side

  if (activeId) setActivePet(activeId);
}

// ---- Window ----
function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 264,
    height: 392,
    x: screenWidth - 282,
    y: 20,
    frame: false,
    // Two recipes for the same look.
    //
    // macOS: an opaque window, because a transparent one disables roundedCorners
    // and leaves the native vibrancy layer square while CSS rounds only the DOM —
    // that mismatch is what shows as chipped corners. Native rounding clips every
    // layer together.
    //
    // Elsewhere: transparency plus the stylesheet's own radius. Windows has no
    // vibrancy, and its acrylic material would in turn forbid transparency and
    // cost us the rounding. Not a real loss: the fill is 95.5% opaque, so barely
    // any backdrop came through even on macOS — compared side by side over a
    // bright pattern the two are hard to tell apart.
    transparent: !IS_MAC,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    ...(IS_MAC ? {
      roundedCorners: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    } : {}),
    minWidth: 210,
    maxWidth: 1000,
    show: false,          // the notch is the resting form; a click opens this
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.setOpacity(OPACITY_IDLE);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setAlwaysOnTop(true, 'floating', 1);
  mainWindow.setVisibleOnAllWorkspaces(true);

  // Poll cursor position every 80ms to detect hover
  let lastBtnRevealed = null;
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !panelVisible) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const overHud = (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    );
    if (overHud !== isHovered) {
      isHovered = overHud;
      mainWindow.webContents.send('hover-change', isHovered);
      refreshOpacity();
    }

    // Pet button visibility: ONLY when cursor is in the edge-strip beside HUD
    // where the button lives, or directly over the button. Hovering HUD body
    // does NOT reveal the button (boss spec).
    if (petButton) {
      const zone = petButton.getHoverZone(bounds);
      const overZone = zone && (
        cursor.x >= zone.x && cursor.x <= zone.x + zone.width &&
        cursor.y >= zone.y && cursor.y <= zone.y + zone.height
      );
      const btnBounds = petButton.getBounds();
      const overBtn = btnBounds && (
        cursor.x >= btnBounds.x && cursor.x <= btnBounds.x + btnBounds.width &&
        cursor.y >= btnBounds.y && cursor.y <= btnBounds.y + btnBounds.height
      );
      const revealed = !!overZone || !!overBtn;
      if (revealed !== lastBtnRevealed) {
        lastBtnRevealed = revealed;
        petButton.setHovered(revealed);
      }
    }
  }, 80);
}

// ---- Notch <-> panel ----
function setPetsVisible(v) {
  if (petWindow) petWindow.setVisible(v);
  if (petButton) petButton.setVisible(v);
  if (!v && petLibrary) petLibrary.close();
}

/**
 * Where a panel opens: beside the notch, or — if the other provider's panel is
 * already sitting there — just to the left of that one, so they never overlap.
 * The notch stays on the edge (folded) while panels are open, so the other ring
 * is always one hover away.
 */
function placePanel(win, other) {
  const b = win.getBounds();
  let at = notch ? notch.anchorFor(b.width, b.height) : { x: b.x, y: b.y };
  if (other && !other.isDestroyed() && other.isVisible()) {
    // Line up away from the notch's edge, so the two panels never overlap.
    const o = other.getBounds();
    at = notch && notch.side === 'left'
      ? { x: o.x + o.width + 10, y: o.y }
      : { x: Math.max(0, o.x - b.width - 10), y: o.y };
  }
  win.setBounds({ ...b, ...at });
}

function openPanel() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (notch) notch.fold();
  if (panelVisible) { mainWindow.show(); return; }
  placePanel(mainWindow, codexWindow);
  panelVisible = true;
  mainWindow.show();
  setPetsVisible(true);
}

function foldPanel() {
  panelVisible = false;
  isHovered = false;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  setPetsVisible(false);
  if (petButton) petButton.setHovered(false);
}

// ---- Codex panel: its own window and its own look, never merged into Claude's ----
const CODEX_W = 248;
function codexPayload() {
  return { codex: usageState.codex, codexStale: usageState.codexStale, codexNote: usageState.codexNote };
}

function openCodexPanel() {
  if (notch) notch.fold();
  if (!codexWindow || codexWindow.isDestroyed()) {
    codexWindow = new BrowserWindow({
      width: CODEX_W, height: 190,
      frame: false,
      transparent: !IS_MAC,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: true,
      show: false,
      ...(IS_MAC ? { roundedCorners: true, vibrancy: 'under-window', visualEffectState: 'active' } : {}),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'codex', 'codex-preload.js'),
      },
    });
    codexWindow.setAlwaysOnTop(true, 'floating', 1);
    codexWindow.setVisibleOnAllWorkspaces(true);
    codexWindow.loadFile(path.join(__dirname, 'codex', 'codex-panel.html'));
    codexWindow.on('closed', () => { codexWindow = null; });
    placePanel(codexWindow, panelVisible ? mainWindow : null);
    codexWindow.once('ready-to-show', () => codexWindow && codexWindow.show());
  } else if (!codexWindow.isVisible()) {
    placePanel(codexWindow, panelVisible ? mainWindow : null);
    codexWindow.show();
  } else {
    codexWindow.show();
  }
  codexLastTry = 0;       // opening is a good moment for a fresh number
  refreshCodex();
}

function foldCodexPanel() {
  if (codexWindow && !codexWindow.isDestroyed()) codexWindow.hide();
}

function pushCodex() {
  if (codexWindow && !codexWindow.isDestroyed()) {
    codexWindow.webContents.send('codex:update', codexPayload());
  }
}

ipcMain.on('codex:get-data', (e) => e.reply('codex:update', codexPayload()));
ipcMain.on('codex:refresh', () => { codexLastTry = 0; refreshCodex(); });
ipcMain.on('codex:fold', () => foldCodexPanel());
ipcMain.on('codex:open-usage', () => shell.openExternal('https://chatgpt.com/codex'));
ipcMain.on('codex:context-menu', () => showContextMenu(codexWindow));
ipcMain.on('codex:fit-height', (e, h) => {
  if (!codexWindow || codexWindow.isDestroyed()) return;
  const b = codexWindow.getBounds();
  const height = Math.max(120, Math.round(h || 0));
  if (height !== b.height) codexWindow.setBounds({ ...b, height });
});

function initNotch() {
  const prefs = loadPrefs();
  notch = new NotchWindow({
    prefs: prefs.notch || {},
    onPrefs: (n) => { const p = loadPrefs(); p.notch = { ...(p.notch || {}), ...n }; savePrefs(p); },
    onActivate: (id) => (id === 'codex' ? openCodexPanel() : openPanel()),
    onContextMenu: () => showContextMenu(notch.window),
  });
  screen.on('display-metrics-changed', () => notch && notch.reseat());
  screen.on('display-removed', () => notch && notch.reseat());
}

// ---- Context menu (right-click on HUD) ----
/**
 * Where Claude Code's own installers leave the binary. `claude` alone is not
 * enough: the native installer puts it in ~/.local/bin, which it adds to the
 * PATH by editing a shell rc file — and a user who only ever opens the desktop
 * app has a binary on disk that no login shell can see.
 */
function claudeBinCandidates() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return [path.join(home, '.local', 'bin', 'claude.exe'),
            path.join(home, '.local', 'bin', 'claude.cmd'),
            path.join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd')];
  }
  return [path.join(home, '.local', 'bin', 'claude'),
          '/opt/homebrew/bin/claude',
          '/usr/local/bin/claude',
          path.join(home, '.bun', 'bin', 'claude'),
          path.join(home, '.volta', 'bin', 'claude')];
}

/**
 * The absolute path to `claude`, or '' when it cannot be found.
 *
 * Asks a login shell first so a PATH the user set up themselves wins over our
 * guesses, then falls back to the known install locations.
 */
function resolveClaudeBin() {
  const fromDisk = () => claudeBinCandidates().find((c) => {
    try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; }
  }) || '';
  if (process.platform === 'win32') return Promise.resolve(fromDisk());
  return new Promise((resolve) => {
    execFile(process.env.SHELL || '/bin/zsh', ['-lc', 'command -v claude'],
      { timeout: 6000 }, (err, stdout) => {
        const hit = !err && String(stdout).trim().split('\n')[0].trim();
        resolve(hit && path.isAbsolute(hit) ? hit : fromDisk());
      });
  });
}

/**
 * Open a terminal sitting at `claude`, so the CLI can run its own /login.
 *
 * The quota comes from Claude Code's standalone OAuth credential, which the
 * desktop app never touches — it carries its own session. So a user who only
 * ever opens the desktop app can have a live Claude and a dead credential at
 * the same time, and "open Claude Code" reads as advice they have already
 * followed. Handing them a terminal is the shortest honest path to it.
 *
 * Deliberately a terminal rather than an in-app OAuth flow: the login stays in
 * Claude Code's hands. It runs the binary by absolute path rather than by name,
 * because the name is exactly what a fresh terminal turned out not to have.
 */
async function openClaudeSignIn() {
  const bin = await resolveClaudeBin();
  if (!bin) {
    dialog.showMessageBox({
      type: 'info',
      message: 'Claude Code is not installed on this machine',
      detail: 'The HUD reads your usage from the Claude Code CLI\u2019s own sign-in, '
            + 'which is separate from the Claude desktop app. Install it from '
            + 'claude.com/claude-code, then sign in once and the bars fill in on their own.',
      buttons: ['OK'],
    });
    return;
  }
  if (process.platform === 'darwin') {
    // AppleScript string, so a path with a quote or backslash has to be escaped.
    const asStr = bin.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    execFile('osascript',
      ['-e', `tell application "Terminal" to do script "${asStr}"`,
       '-e', 'tell application "Terminal" to activate'],
      (err) => { if (err) console.log('[HUD] sign-in terminal failed:', err.message); });
  } else if (process.platform === 'win32') {
    try { spawn('cmd.exe', ['/c', 'start', '', 'cmd.exe', '/k', bin], { detached: true }).unref(); }
    catch (e) { console.log('[HUD] sign-in terminal failed:', e.message); }
  }
}

function showContextMenu(fromWindow) {
  const prefs = loadPrefs();
  const currentAnchor = (prefs.pet && prefs.pet.anchor) || 'BR';
  const anchorMenu = ['TL','TC','LC','BL','BC','BR','RC'].map((a) => ({
    label: ({TL:'Top-Left',TC:'Top-Center',LC:'Left-Center',BL:'Bottom-Left',BC:'Bottom-Center',BR:'Bottom-Right (default)',RC:'Right-Center'})[a],
    type: 'radio',
    checked: currentAnchor === a,
    click: () => {
      if (petWindow) petWindow.setAnchor(a);
      const p = loadPrefs(); p.pet = p.pet || {}; p.pet.anchor = a; savePrefs(p);
    },
  }));

  const codexOpen = codexWindow && !codexWindow.isDestroyed() && codexWindow.isVisible();
  const template = [
    panelVisible
      ? { label: 'Fold Claude Panel', click: () => foldPanel() }
      : { label: 'Open Claude Panel', click: () => openPanel() },
    ...(usageState.codex ? [codexOpen
      ? { label: 'Fold Codex Panel', click: () => foldCodexPanel() }
      : { label: 'Open Codex Panel', click: () => openCodexPanel() }] : []),
    { type: 'separator' },
    ...(notch ? [
      { label: 'Pin Notch', type: 'checkbox', checked: notch.isPinned(),
        click: (item) => notch.setPinned(item.checked) },
      { label: 'Notch Side', submenu: ['right', 'left'].map((side) => ({
        label: side === 'right' ? 'Right Edge' : 'Left Edge', type: 'radio',
        checked: notch.side === side, click: () => notch.setSide(side),
      })) },
      { type: 'separator' },
    ] : []),
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: isAutoStartEnabled(),
      click: (menuItem) => {
        const enabled = menuItem.checked;
        applyAutoStart(enabled);
        const p = loadPrefs();
        p.openAtLogin = enabled;
        savePrefs(p);
      }
    },
    { type: 'separator' },
    {
      label: 'Pet Library',
      click: () => { if (petLibrary) petLibrary.toggle(); }
    },
    {
      label: 'Pet Anchor',
      submenu: anchorMenu,
    },
    { type: 'separator' },
    {
      label: usageState.quotaStale || !usageState.quota
        ? 'Sign in to Claude Code (quota is stale)…'
        : 'Sign in to Claude Code…',
      click: () => openClaudeSignIn(),
    },
    { type: 'separator' },
    {
      label: 'Open claude.ai Usage Page',
      click: () => shell.openExternal('https://claude.ai/new#settings/usage')
    },
    {
      label: 'Reload Widget',
      click: () => { if (mainWindow) mainWindow.reload(); }
    },
    { type: 'separator' },
    {
      label: `HUD for Claude v${app.getVersion()}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: `About · by ${AUTHOR}`,
      click: () => shell.openExternal(REPO_URL),
    },
    { type: 'separator' },
    {
      label: 'Quit HUD for Claude',
      click: () => app.quit()
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  const win = fromWindow || mainWindow;
  if (win && !win.isDestroyed()) menu.popup({ window: win });
}


// ---- Usage service ----
// Two independent legs:
//   quota  -> /api/oauth/usage, authorised by Claude Code's keychain credential
//   local  -> ~/.claude/projects transcripts, scanned incrementally on disk
// Neither sends anything off this machine.

/**
 * Translate the extension's payload into the shape the renderer reads.
 *
 * This is the Windows path: the keychain is macOS-only, so quota there comes
 * from the extension scraping claude.ai. Its reset fields are human strings
 * ("in 4h 12m", "Mon 3:00 PM") rather than ISO timestamps, so they are passed
 * through as resetsText for the renderer to print verbatim.
 */
function fromExtensionShape(d) {
  if (!d || !d.found) return null;
  const row = (percent, text) => (typeof percent === 'number')
    ? { percent, severity: 'normal', resetsAt: null, resetsText: text || null, isActive: true }
    : null;
  return {
    ok: true,
    source: 'extension',
    fetchedAt: Date.now(),
    plan: null,
    session: row(d.session, d.session_reset ? 'in ' + d.session_reset : null),
    weeklyAll: row(d.weekly_all, d.weekly_reset || null),
    weeklyScoped: row(d.weekly_sonnet, null),
    extraUsage: d.extra_usage ? {
      utilization: d.extra_usage.percent,
      monthlyLimit: d.extra_usage.limit,
      usedCredits: d.extra_usage.spent,
      currency: 'USD',
    } : null,
  };
}

/** Pet speaks the old extension dialect; translate rather than touch pet code. */
function toPetShape() {
  const q = usageState.quota;
  if (!q) return extensionData || { found: false };
  return {
    found: true,
    session: q.session ? q.session.percent : 0,
    weekly_all: q.weeklyAll ? q.weeklyAll.percent : 0,
    extra_usage: q.extraUsage ? { percent: q.extraUsage.utilization } : null,
  };
}

function pushUsage() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Fall back to the extension's reading whenever the OAuth leg has nothing.
    const quota = usageState.quota || fromExtensionShape(extensionData);
    mainWindow.webContents.send('usage-update', { ...usageState, quota });
  }
  if (petWindow) petWindow.updateUsage(toPetShape());
  if (notch) notch.update(notchPayload());
  pushCodex();
}

/** What the notch draws: one ring per provider, plus rows for its hover card. */
function notchPayload() {
  const providers = [];
  const q = usageState.quota || fromExtensionShape(extensionData);
  const row = (label, r) => r && typeof r.percent === 'number'
    ? { label, percent: r.percent, resetsAt: r.resetsAt || null, resetsText: r.resetsText || null }
    : null;
  const plan = (usageState.profile && usageState.profile.plan) || (q && q.plan) || null;
  providers.push({
    id: 'claude', label: 'Claude', plan,
    ring: q && q.session ? q.session.percent : null,
    stale: !q || !!usageState.quotaStale,
    note: q ? (usageState.quotaStale ? 'Sign-in expired — right-click → Sign in to Claude Code' : null)
            : 'Right-click → Sign in to Claude Code',
    rows: q ? [row('Current session', q.session), row('Weekly · all models', q.weeklyAll)].filter(Boolean) : [],
  });
  const c = usageState.codex;
  if (c) {
    providers.push({
      id: 'codex', label: 'Codex', plan: c.plan,
      ring: c.primary ? c.primary.percent : (c.secondary ? c.secondary.percent : null),
      stale: !!usageState.codexStale,
      note: usageState.codexNote,
      rows: [row(windowLabel(c.primary, '5-hour'), c.primary),
             row(windowLabel(c.secondary, 'Weekly'), c.secondary)].filter(Boolean),
    });
  }
  return { providers };
}

function windowLabel(w, fallback) {
  const s = w && w.windowSeconds;
  if (!s) return fallback;
  if (s === 604800) return 'Weekly';
  if (s % 3600 === 0 && s < 86400) return (s / 3600) + '-hour';
  if (s % 86400 === 0) return (s / 86400) + '-day';
  return fallback;
}

const QUOTA_INTERVAL = 75000;
const QUOTA_BACKOFF_MAX = 900000;   // 15 min
let quotaBackoff = 0;
let quotaTimer = null;
let lastQuotaOk = Date.now();

async function refreshQuota() {
  try {
    usageState.quota = await OAuthUsage.fetchQuota();
    usageState.quotaStale = false;
    quotaBackoff = 0;
    lastQuotaOk = Date.now();
  } catch (e) {
    // Two failure modes, same response: keep the last good reading and mark it
    // stale rather than blanking the rows. A 429 additionally backs off — polling
    // harder against a rate limit only digs deeper.
    if (e.status === 429) {
      quotaBackoff = Math.min(QUOTA_BACKOFF_MAX, quotaBackoff ? quotaBackoff * 2 : QUOTA_INTERVAL);
      console.log('[HUD] quota rate-limited; backing off to',
                  Math.round((QUOTA_INTERVAL + quotaBackoff) / 1000) + 's');
    } else {
      console.log('[HUD] quota via OAuth unavailable:', e.message);
    }
    if (usageState.quota) usageState.quotaStale = true;
    else usageState.quota = null;
  } finally {
    // The loop reschedules itself, so anything that throws between here and
    // scheduleQuota() would stop polling permanently rather than skip one tick.
    // A render push is not worth that, so it is contained.
    try { pushUsage(); } catch (err) { console.log('[HUD] push failed:', err.message); }
    scheduleQuota();
  }
}

function scheduleQuota() {
  if (quotaTimer) clearTimeout(quotaTimer);
  quotaTimer = setTimeout(refreshQuota, QUOTA_INTERVAL + quotaBackoff);
}

// Codex has no session events to key off, so it is polled on a fixed, gentle
// cadence. 'absent' (never signed in / API-key mode) hides the ring entirely;
// every other failure keeps the last reading and marks it stale.
const CODEX_INTERVAL = 150000;
const CODEX_BACKOFF_MAX = 1800000;   // 30 min
let codexBackoff = 0;
let codexTimer = null;
let codexInFlight = false;
let codexLastTry = 0;

async function refreshCodex() {
  // A manual or panel-open refresh must not hammer the endpoint.
  if (codexInFlight || Date.now() - codexLastTry < 20000) return;
  codexInFlight = true;
  codexLastTry = Date.now();
  try {
    usageState.codex = await CodexUsage.fetchQuota();
    usageState.codexStale = false;
    usageState.codexNote = null;
    codexBackoff = 0;
  } catch (e) {
    if (e.absent) {
      usageState.codex = null;
    } else {
      if (e.status === 429) {
        codexBackoff = Math.min(CODEX_BACKOFF_MAX, codexBackoff ? codexBackoff * 2 : CODEX_INTERVAL);
      }
      usageState.codexNote = (e.status === 401 || e.status === 403)
        ? 'Open Codex once to renew its sign-in' : null;
      if (usageState.codex) usageState.codexStale = true;
      console.log('[HUD] codex usage unavailable:', e.message);
    }
  } finally {
    codexInFlight = false;
    try { pushUsage(); } catch (err) { console.log('[HUD] push failed:', err.message); }
    if (codexTimer) clearTimeout(codexTimer);
    codexTimer = setTimeout(refreshCodex, CODEX_INTERVAL + codexBackoff);
  }
}

async function refreshLocal() {
  try {
    await scanner.refresh();
    usageState.local = scanner.stats();
  } catch (e) {
    console.log('[HUD] local usage scan failed:', e.message);
  }
  pushUsage();
}

function startUsageService() {
  scanner = new LocalUsageScanner(path.join(app.getPath('userData'), 'usage-cache.json'));
  OAuthUsage.fetchProfile()
    .then((prof) => { usageState.profile = prof; pushUsage(); })
    .catch(() => {});
  refreshQuota();          // reschedules itself, with backoff on 429
  refreshCodex();          // same, on its own cadence
  refreshLocal();
  setInterval(refreshLocal, 30000);

  // A sleeping Mac suspends the timer, and it does not necessarily fire on its
  // own schedule again afterwards — which is how the readout can sit hours stale
  // while the app looks perfectly alive. Refresh the moment the machine is back.
  powerMonitor.on('resume', () => {
    console.log('[HUD] system resumed — refreshing');
    quotaBackoff = 0;
    refreshQuota();
    codexLastTry = 0;
    refreshCodex();
    refreshLocal();
  });
  powerMonitor.on('unlock-screen', () => { quotaBackoff = 0; refreshQuota(); });

  // Independent backstop on setInterval, which does not depend on any callback
  // completing. If the self-rescheduling loop ever dies again, this restarts it.
  setInterval(() => {
    const idle = Date.now() - lastQuotaOk;
    if (idle > 10 * 60 * 1000) {
      console.log('[HUD] watchdog: no quota for', Math.round(idle / 60000), 'min — restarting poll');
      quotaBackoff = 0;
      refreshQuota();
    }
  }, 120000);
}

// ---- WebSocket server ----
function startWebSocketServer() {
  wss = new WebSocket.Server({ port: 27843 });
  wss.on('connection', (ws) => {
    // Notify renderer that extension just connected
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-change', true);
    }
    ws.on('message', (raw) => {
      try {
        extensionData = JSON.parse(raw.toString());
        // Only surfaces when the OAuth read is failing.
        if (!usageState.quota) pushUsage();
      } catch (e) {}
    });
    ws.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-change', false);
      }
    });
  });
  wss.on('error', (e) => console.log('[HUD for Claude] WS error:', e.message));
}

// ---- IPC handlers ----
ipcMain.on('set-opacity', (event, val) => {
  if (mainWindow) mainWindow.setOpacity(val);
});
ipcMain.on('close-app', () => app.quit());
ipcMain.on('fold-panel', () => foldPanel());
ipcMain.on('refresh-now', () => {
  quotaBackoff = 0;
  refreshQuota();
  refreshCodex();
  refreshLocal();
});

ipcMain.on('get-data', (event) => {
  const quota = usageState.quota || fromExtensionShape(extensionData);
  event.reply('usage-update', { ...usageState, quota });
});
// Floor the window at the height its leanest layout needs, so dragging shorter
// stops at that point instead of scaling the content down. The renderer knows
// the number because only it has measured the layout.
let lastMinHeight = 0;
ipcMain.on('set-min-height', (event, height) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const h = Math.max(80, Math.round(height || 0));
  if (h === lastMinHeight) return;
  lastMinHeight = h;
  const [minW] = mainWindow.getMinimumSize();
  mainWindow.setMinimumSize(minW, h);
  const b = mainWindow.getBounds();
  if (b.height < h) mainWindow.setBounds({ ...b, height: h });
});

ipcMain.on('set-opacity-lock', (event, locked) => {
  opacityLocked = !!locked;
  refreshOpacity();
});
ipcMain.on('open-repo', () => shell.openExternal(REPO_URL));
ipcMain.on('show-context-menu', () => showContextMenu());
ipcMain.on('resize-window', (event, height) => {
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({ ...bounds, height: Math.round(height) });
  }
});
ipcMain.handle('get-autostart', () => isAutoStartEnabled());
ipcMain.on('set-autostart', (event, enabled) => {
  applyAutoStart(enabled);
  const prefs = loadPrefs();
  prefs.openAtLogin = enabled;
  savePrefs(prefs);
});

// ---- App lifecycle ----
app.whenReady().then(() => {
  // Populates the native macOS about panel with the same attribution.
  app.setAboutPanelOptions({
    applicationName: 'HUD for Claude',
    applicationVersion: app.getVersion(),
    credits: `by ${AUTHOR} — ${REPO_URL}`,
    copyright: `© 2026 ${AUTHOR}. MIT licensed.`,
  });

  // Apply persisted auto-start preference (first launch defaults to ON)
  const prefs = loadPrefs();
  applyAutoStart(prefs.openAtLogin !== false);
  if (prefs.firstLaunch) {
    delete prefs.firstLaunch;
    savePrefs(prefs);
  }

  startWebSocketServer();
  createWindow();
  initPet();
  initNotch();
  startUsageService();
});

app.on('window-all-closed', () => app.quit());
