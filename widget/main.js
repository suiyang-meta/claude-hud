const { app, BrowserWindow, ipcMain, screen, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

let mainWindow;
let latestData = null;
let wss;
let isHovered = false;

// ---- Preferences (persisted across launches) ----
const PREFS_PATH = path.join(app.getPath('userData'), 'prefs.json');

function loadPrefs() {
  try {
    if (fs.existsSync(PREFS_PATH)) {
      return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
    }
  } catch (e) {
    console.log('[Claude HUD] Failed to read prefs:', e.message);
  }
  // First launch defaults: auto-start ON
  return { openAtLogin: true, firstLaunch: true };
}

function savePrefs(prefs) {
  try {
    fs.mkdirSync(path.dirname(PREFS_PATH), { recursive: true });
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch (e) {
    console.log('[Claude HUD] Failed to save prefs:', e.message);
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
  return app.getLoginItemSettings().openAtLogin;
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
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const cursor = screen.getCursorScreenPoint();
    const bounds = mainWindow.getBounds();
    const over = (
      cursor.x >= bounds.x &&
      cursor.x <= bounds.x + bounds.width &&
      cursor.y >= bounds.y &&
      cursor.y <= bounds.y + bounds.height
    );
    if (over !== isHovered) {
      isHovered = over;
      mainWindow.webContents.send('hover-change', isHovered);
    }
  }, 80);
}

// ---- Context menu (right-click on HUD) ----
function showContextMenu() {
  const template = [
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: isAutoStartEnabled(),
      click: (menuItem) => {
        const enabled = menuItem.checked;
        applyAutoStart(enabled);
        const prefs = loadPrefs();
        prefs.openAtLogin = enabled;
        savePrefs(prefs);
      }
    },
    { type: 'separator' },
    {
      label: 'Open claude.ai Usage Page',
      click: () => shell.openExternal('https://claude.ai/settings/usage')
    },
    {
      label: 'Reload Widget',
      click: () => { if (mainWindow) mainWindow.reload(); }
    },
    { type: 'separator' },
    {
      label: `Claude HUD v${app.getVersion()}`,
      enabled: false
    },
    {
      label: 'Quit Claude HUD',
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
      } catch (e) {}
    });
    ws.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-change', false);
      }
    });
  });
  wss.on('error', (e) => console.log('[Claude HUD] WS error:', e.message));
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
});

app.on('window-all-closed', () => app.quit());
