// Dev-only: render index.html with REAL data and save a PNG.
// Uses Electron's own capturePage, so it needs no screen-recording permission.
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const OAuthUsage = require('./usage/OAuthUsage');
const { LocalUsageScanner } = require('./usage/LocalUsage');

const wait = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const scanner = new LocalUsageScanner(path.join(app.getPath('userData'), 'usage-cache.json'));
  await scanner.refresh();
  const state = { local: scanner.stats(), quota: null, profile: null };
  try {
    state.quota = await OAuthUsage.fetchQuota();
  } catch (e) {
    console.log('quota:', e.message);
    // DEV-ONLY. Last real reading, pinned so CSS can be checked while the
    // hourly token is expired. Never rendered by the app itself — shot.js is
    // excluded from the build. Anything here is a SNAPSHOT, not live data.
    if (process.env.HUD_SHOT_SNAPSHOT) {
      console.log('  !! using PINNED SNAPSHOT quota for visual check only');
      state.quota = {
        plan: 'max', fetchedAt: Date.now() - 9 * 60000,
        session:   { percent: 17, severity: 'normal', resetsAt: new Date(Date.now()+4.4*3600e3).toISOString(), isActive: true },
        weeklyAll: { percent: 19, severity: 'normal', resetsAt: new Date(Date.now()+5.7*86400e3).toISOString(), isActive: true },
        extraUsage: null,
      };
      state.quotaStale = true;
    }
  }
  try { state.profile = await OAuthUsage.fetchProfile(); } catch (e) { console.log('profile:', e.message); }

  ipcMain.on('get-data', (e) => e.reply('usage-update', state));
  ipcMain.on('resize-window', (e, h) => {
    const b = w.getBounds();
    w.setBounds({ ...b, height: Math.round(h) });
    console.log('renderer asked for height', Math.round(h));
  });

  var w;
  w = new BrowserWindow({
    width: 300, height: 405, frame: false, transparent: false,
    backgroundColor: '#00000000', roundedCorners: true,
    vibrancy: 'under-window', visualEffectState: 'active',
    show: true, x: 40, y: 40,
    webPreferences: { preload: path.join(__dirname, 'preload.js'),
                      contextIsolation: true, nodeIntegration: false },
  });
  await w.loadFile(path.join(__dirname, 'index.html'));
  await wait(1500);
  await w.webContents.executeJavaScript(
    "document.getElementById('hud').classList.add('hovered')");   // full opacity for the shot
  await wait(700);
  const compact = await w.webContents.executeJavaScript(`(() => {
    const hud = document.getElementById('hud');
    const body = document.getElementById('body');
    const g = document.querySelector('.grow');
    if (g) g.style.display = 'none';           // filler out
    hud.style.height = 'auto';                 // let it size to content
    const h = hud.getBoundingClientRect().height;
    hud.style.height = '';                     // restore
    if (g) g.style.display = '';
    return Math.ceil(h);
  })()`);
  console.log('CONTENT WANTS:', compact, 'px  (window is currently 430)');
  if (process.env.HUD_SHOT_COMPACT) {
    await w.webContents.executeJavaScript("document.getElementById('btnMini').click()");
    await wait(900);
    console.log('  toggled compact mode');
  }
  if (process.env.HUD_SHOT_WIDE) {
    const wd = Number(process.env.HUD_SHOT_WIDE) || 720;
    w.setBounds({ ...w.getBounds(), width: wd, height: Math.round(wd / 1.85) });
    await wait(1400);
    const b = w.getBounds();
    console.log('  landscape settled at', b.width + 'x' + b.height,
                '(ratio ' + (b.width / b.height).toFixed(2) + ')');
  }
  const widths = (process.argv[3] || '').split(',').filter(Boolean).map(Number);
  if (widths.length) {
    for (const px of widths) {
      w.setBounds({ ...w.getBounds(), width: px });
      await wait(900);
      const im = await w.webContents.capturePage();
      const b = w.getBounds();
      fs.writeFileSync(`/tmp/hud-w${px}.png`, im.toPNG());
      console.log(`  width ${px} -> window ${b.width}x${b.height}`);
    }
  }
  const img = await w.webContents.capturePage();
  fs.writeFileSync(process.argv[2] || '/tmp/hud-shot.png', img.toPNG());
  console.log('captured. quota=' + (state.quota ? 'ok' : 'null') +
              ' profile=' + (state.profile ? 'ok' : 'null') +
              ' today=$' + state.local.today.usd.toFixed(2));
  app.quit();
});
