'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * Updater — notices a newer release, fetches it in the background, and swaps it
 * in when the user says so.
 *
 * Not electron-updater: its macOS half is Squirrel.Mac, which will not update an
 * app that is not signed with an Apple Developer ID, and this one is not. So the
 * install is the same steps install.sh and install.ps1 already take — put the
 * new app where the old one was, open it — done by a small script the app
 * leaves running as it quits, since a running app cannot replace itself.
 *
 * Where: a Cloudflare R2 bucket of its own, not GitHub Releases — the repo is
 * source-only on purpose (prebuilt installers are Gumroad's), and this keeps
 * where the app fetches updates apart from where people download it.
 *   <BASE>/latest.json                 {"manifest": "<json text>", "signature": "<base64>"}
 *   <BASE>/v<version>/<file name>      the installers it lists
 * The signature travels inside the same file as what it signs, so no cache can
 * ever pair a new manifest with an old signature.
 *
 * Trust does not rest on the host. The manifest is signed with an Ed25519 key
 * that exists only on the release machine; the app carries the public half,
 * refuses a manifest whose signature does not verify, and refuses a download
 * whose size or SHA-256 differs from the manifest. Whoever could write to the
 * bucket could publish a release, but not one this app installs.
 *
 * Phases: idle → checking → current | downloading → ready | available (cannot
 * install itself; the user is sent to the download page) | error.
 */
const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const PUBLIC_KEY = require('./publicKey');

// HUD_UPDATE_BASE points a test run at a local server laid out the same way.
const BASE = process.env.HUD_UPDATE_BASE || 'https://pub-73af813618eb49f9a18951f929fab6e6.r2.dev';
const DOWNLOAD_PAGE = 'https://metasui.gumroad.com/l/evlikv';
const PLATFORM = `${process.platform}-${process.arch}`;   // 'darwin-arm64', 'win32-x64'
const CHECK_EVERY = 6 * 3600 * 1000;
const FIRST_CHECK = 60 * 1000;          // after launch, once the usage reads have settled
const STALL_MS = 60 * 1000;             // a download with no bytes this long is dead

/** Is version a newer than version b? Both plain x.y.z. */
function newer(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function fetchText(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
    return await r.text();
  } finally { clearTimeout(timer); }
}

/** latest.json, verified and shape-checked, or a thrown reason. */
function readManifest(file) {
  let text, sig;
  try { ({ manifest: text, signature: sig } = JSON.parse(file)); } catch { /* checked next */ }
  if (typeof text !== 'string' || typeof sig !== 'string') throw new Error('the release information is unreadable');
  const ok = crypto.verify(null, Buffer.from(text, 'utf8'), crypto.createPublicKey(PUBLIC_KEY),
                           Buffer.from(sig, 'base64'));
  if (!ok) throw new Error('the release’s signature does not match this app’s key');
  const m = JSON.parse(text);
  if (!/^\d+\.\d+\.\d+$/.test(m.version || '')) throw new Error('the release has no valid version');
  const f = m.files && m.files[PLATFORM];
  // Signed, but checked anyway: the name becomes part of a path and a URL.
  if (f && !(typeof f.name === 'string' && /^[\w.-]+$/.test(f.name)
             && Number.isSafeInteger(f.size) && f.size > 0 && /^[0-9a-f]{64}$/.test(f.sha256 || ''))) {
    throw new Error('the release lists a malformed file');
  }
  return { version: m.version, file: f || null };
}

/** Does the file on disk already match? Saves re-downloading after a relaunch. */
function matches(file, expect) {
  try {
    if (fs.statSync(file).size !== expect.size) return false;
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === expect.sha256;
  } catch { return false; }
}

async function download(url, dest, expect, onProgress) {
  const ctl = new AbortController();
  let stall = setTimeout(() => ctl.abort(), STALL_MS);
  const out = fs.createWriteStream(dest);
  const hash = crypto.createHash('sha256');
  let got = 0;
  try {
    const r = await net.fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status} downloading the update`);
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      clearTimeout(stall); stall = setTimeout(() => ctl.abort(), STALL_MS);
      got += value.length;
      if (got > expect.size) throw new Error('the download is larger than the release says');
      hash.update(value);
      if (!out.write(value)) await new Promise((res) => out.once('drain', res));
      onProgress(got / expect.size);
    }
  } finally {
    clearTimeout(stall);
    await new Promise((res) => out.end(res));
  }
  if (got !== expect.size) throw new Error('the download was cut short');
  if (hash.digest('hex') !== expect.sha256) throw new Error('the download does not match the signed release');
}

/**
 * Where the running app lives, or null when it cannot replace itself there:
 * a dev run (the "app" is Electron itself), a copy opened straight from the
 * disk image, one Gatekeeper moved to a read-only path, or a folder this user
 * cannot write to.
 */
function installTarget() {
  if (!app.isPackaged) return null;
  const exe = app.getPath('exe');
  let dir;
  if (process.platform === 'darwin') {
    dir = path.resolve(exe, '..', '..', '..');
    if (!dir.endsWith('.app')) return null;
  } else if (process.platform === 'win32') {
    dir = path.dirname(exe);
  } else {
    return null;
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    fs.accessSync(path.dirname(dir), fs.constants.W_OK);
  } catch { return null; }
  return dir;
}

class Updater {
  /** @param {{onChange: (state: object) => void}} o */
  constructor({ onChange }) {
    this.onChange = onChange || (() => {});
    this.state = { phase: 'idle' };
    this.target = installTarget();
    this.auto = true;
    this.lastCheck = 0;
    this.downloadPage = DOWNLOAD_PAGE;
    // Set by the install script when it had to put the old version back.
    this.failure = process.env.HUD_UPDATE_FAILED || null;
    delete process.env.HUD_UPDATE_FAILED;
  }

  /** Scratch space for downloads. On Windows it sits beside the install so the
   *  final swap is a rename on one volume, not a copy across two. */
  _workRoot() {
    return process.platform === 'win32' && this.target
      ? path.join(path.dirname(this.target), 'HUD for Claude.update')
      : path.join(app.getPath('temp'), 'hud-for-claude-update');
  }

  _set(s) { this.state = s; this.onChange(s); }

  start(auto) {
    this.auto = auto;
    setTimeout(() => this._due(), FIRST_CHECK);
    // Polled rather than one long timer: a sleeping Mac suspends timers, and a
    // six-hour one could then slip by a day.
    setInterval(() => this._due(), 30 * 60 * 1000);
  }

  setAuto(on) { this.auto = on; if (on) this._due(); }

  _due() {
    if (this.auto && Date.now() - this.lastCheck >= CHECK_EVERY) this.check().catch(() => {});
  }

  /**
   * Look for a newer release. Resolves once that is known; a download it starts
   * carries on in the background, and `downloaded` settles when it ends.
   */
  async check() {
    const busy = ['checking', 'downloading', 'ready'];
    if (busy.includes(this.state.phase)) return this.state;
    this.lastCheck = Date.now();
    this._set({ phase: 'checking' });
    let found;
    try {
      found = readManifest(await fetchText(`${BASE}/latest.json`));
    } catch (e) {
      // Nothing published yet is not a fault on this machine; say so plainly
      // rather than as an error.
      if (e.status === 404) { this._set({ phase: 'current', version: app.getVersion() }); return this.state; }
      this._set({ phase: 'error', message: e.message });
      return this.state;
    }
    if (!newer(found.version, app.getVersion()) || !found.file) {
      this._set({ phase: 'current', version: app.getVersion() });
      return this.state;
    }
    if (!this.target) {
      this._set({ phase: 'available', version: found.version });
      return this.state;
    }
    this.downloaded = this._fetch(found.version, found.file);
    return this.state;
  }

  async _fetch(version, file) {
    const root = this._workRoot();
    const work = path.join(root, version);
    const dest = path.join(work, file.name);
    try {
      // Older versions' leftovers go; this version's finished download stays.
      fs.mkdirSync(work, { recursive: true });
      for (const d of fs.readdirSync(root)) {
        if (d !== version) fs.rmSync(path.join(root, d), { recursive: true, force: true });
      }
      if (!matches(dest, file)) {
        this._set({ phase: 'downloading', version, progress: 0 });
        let shown = 0;
        await download(`${BASE}/v${version}/${file.name}`, dest, file, (p) => {
          if (p - shown >= 0.02) { shown = p; this._set({ phase: 'downloading', version, progress: p }); }
        });
      }
      this._set({ phase: 'ready', version, file: dest, work });
    } catch (e) {
      fs.rmSync(dest, { force: true });
      this._set({ phase: 'error', message: e.message });
    }
    return this.state;
  }

  /** Quit, and leave a script behind that swaps the new version in and opens it. */
  install() {
    const s = this.state;
    if (s.phase !== 'ready' || !this.target) return false;
    const log = path.join(app.getPath('userData'), 'update.log');
    let child;
    if (process.platform === 'darwin') {
      const script = path.join(s.work, 'update.sh');
      fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'update-mac.sh')), { mode: 0o755 });
      child = spawn('/bin/bash', [script, String(process.pid), s.file, this.target, s.work, s.version, log],
                    { detached: true, stdio: 'ignore' });
    } else {
      const script = path.join(s.work, 'update.ps1');
      fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'update-win.ps1')));
      child = spawn('powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script,
         '-AppPid', String(process.pid), '-Zip', s.file, '-InstallDir', this.target,
         '-Work', s.work, '-Version', s.version, '-Log', log],
        { detached: true, stdio: 'ignore', windowsHide: true, cwd: s.work });
    }
    child.unref();
    app.quit();
    return true;
  }
}

module.exports = Updater;
