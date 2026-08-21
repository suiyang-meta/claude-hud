const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const PetWindow = require('./pet/PetWindow');
const PetLibrary = require('./pet/PetLibrary');
const PetButton = require('./pet/PetButton');
const codexAdapter = require('./pet/CodexPetAdapter');
const OAuthUsage = require('./usage/OAuthUsage');
const { LocalUsageScanner } = require('./usage/LocalUsage');

let mainWindow;
// Quota now comes from Claude Code's own OAuth credential; the extension
// WebSocket is kept only as a fallback for when that read fails.
let usageState = { quota: null, local: null, profile: null, quotaStale: false };
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

  petWindow = new PetWindow({ anchor });
  petWindow.attachHud(mainWindow);

  petButton = new PetButton({
    onClick: () => { if (petLibrary) petLibrary.toggle(); },
  });
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
    // NOT transparent: a transparent window disables macOS roundedCorners, which
    // leaves the native vibrancy layer square while CSS rounds only the DOM —
    // that mismatch is what shows as chipped top corners. Letting the native
    // corner radius clip every layer keeps them in register.
    transparent: false,
    backgroundColor: '#00000000',
    roundedCorners: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    // Native frosted glass. The CSS fill is translucent so this shows through;
    // macOS-only, and harmlessly ignored elsewhere.
    vibrancy: 'under-window',
    visualEffectState: 'active',
    minWidth: 210,
    maxWidth: 1000,
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
    if (!mainWindow || mainWindow.isDestroyed()) return;
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

// ---- Context menu (right-click on HUD) ----
function showContextMenu() {
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

  const template = [
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
    {
      label: 'Quit HUD for Claude',
      click: () => app.quit()
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  if (mainWindow) menu.popup({ window: mainWindow });
}


// ---- Usage service ----
// Two independent legs:
//   quota  -> /api/oauth/usage, authorised by Claude Code's keychain credential
//   local  -> ~/.claude/projects transcripts, scanned incrementally on disk
// Neither sends anything off this machine.

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
    mainWindow.webContents.send('usage-update', usageState);
  }
  if (petWindow) petWindow.updateUsage(toPetShape());
}

const QUOTA_INTERVAL = 75000;
const QUOTA_BACKOFF_MAX = 900000;   // 15 min
let quotaBackoff = 0;
let quotaTimer = null;

async function refreshQuota() {
  try {
    usageState.quota = await OAuthUsage.fetchQuota();
    usageState.quotaStale = false;
    quotaBackoff = 0;
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
  }
  pushUsage();
  scheduleQuota();
}

function scheduleQuota() {
  if (quotaTimer) clearTimeout(quotaTimer);
  quotaTimer = setTimeout(refreshQuota, QUOTA_INTERVAL + quotaBackoff);
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
  refreshLocal();
  setInterval(refreshLocal, 30000);
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
ipcMain.on('get-data', (event) => {
  event.reply('usage-update', usageState);
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
  startUsageService();
});

app.on('window-all-closed', () => app.quit());
