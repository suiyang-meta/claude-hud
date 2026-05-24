const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const PetWindow = require('./pet/PetWindow');
const PetLibrary = require('./pet/PetLibrary');
const PetButton = require('./pet/PetButton');
const codexAdapter = require('./pet/CodexPetAdapter');

let mainWindow;
let latestData = null;
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

  if (activeId) setActivePet(activeId);
}

// ---- Window ----
function createWindow() {
  const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 278,
    height: 230,
    x: screenWidth - 295,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

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
        const data = JSON.parse(raw.toString());
        latestData = data;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('usage-update', data);
        }
        if (petWindow) petWindow.updateUsage(data);
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
  event.reply('usage-update', latestData || { found: false });
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
});

app.on('window-all-closed', () => app.quit());
