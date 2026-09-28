'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * SystemMonitor — where this machine's load is coming from, right now.
 *
 * Not four gauges but a verdict: every few seconds it reads CPU, memory, GPU,
 * disk and heat, picks the one under the most pressure, and names what is
 * behind it — an app, a dev server (by project), or a Claude Code session.
 *
 * Sources on macOS:
 *   ps          every process's CPU time, resident size and path. /bin/ps is
 *               setuid root, so it sees system processes too.
 *   hud-sysmon  memory footprint, disk I/O and owning app for this user's
 *               processes; GPU time per process; temperatures; memory pressure
 *               and swap; a process's working directory. See hud-sysmon.c.
 *   os.cpus()   total CPU;  fs.statfs  disk space;  powerMonitor  thermal state
 * On Windows: os.cpus / os.totalmem / fs.statfs, plus one long-lived
 * PowerShell for per-process CPU time and working set. No GPU, heat or disk
 * activity there.
 *
 * Read-only: it starts nothing but its own helper, writes nothing, sends
 * nothing off this machine.
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const INTERVAL = 4000;
// macOS keeps the OS on a sealed system volume that holds only its own ~12 GB;
// everything else lives on the Data volume. Reading '/' reports 24% used on a
// disk that is 91% full.
const DISK_MOUNT = IS_MAC ? '/System/Volumes/Data'
  : IS_WIN ? (process.env.SystemDrive || 'C:') + '\\' : '/';

const RANK = { normal: 0, warn: 1, critical: 2 };
const byPct = (p, warn, crit) => (p >= crit ? 'critical' : p >= warn ? 'warn' : 'normal');

// ---- Naming: which app, dev server or session a process belongs to ----

// Language runtimes: the binary says nothing about whose code it runs, so
// these are named by project (from their arguments or working directory).
const RUNTIME = /^(node|bun|deno|python[\d.]*|ruby|java|php|go|cargo|rustc|uv|dotnet)$/;
// Agent CLIs, named by the project each session is working in. Claude Code
// ships inside a "claude.app" bundle, so this check must come before the
// bundle check or every session would be filed as an app called "claude".
const AGENT = { claude: 'Claude Code', codex: 'Codex CLI' };
// System processes that are behind most "why is my Mac slow" moments, under
// the name a person would recognise.
const SYSTEM = {
  kernel_task: ['macOS kernel', 'kernel', 'high CPU here usually means the Mac is too hot and throttling'],
  WindowServer: ['WindowServer', 'WindowSrv', 'draws everything on screen'],
  mds: ['Spotlight', 'Spotlight', 'indexing files'],
  mds_stores: ['Spotlight', 'Spotlight', 'indexing files'],
  mdworker: ['Spotlight', 'Spotlight', 'indexing files'],
  mdworker_shared: ['Spotlight', 'Spotlight', 'indexing files'],
  mdsync: ['Spotlight', 'Spotlight', 'indexing files'],
  corespotlightd: ['Spotlight', 'Spotlight', 'indexing files'],
  backupd: ['Time Machine', 'TimeMach', 'backing up'],
  'backupd-helper': ['Time Machine', 'TimeMach', 'backing up'],
  photoanalysisd: ['Photos analysis', 'Photos', 'scanning the photo library'],
  mediaanalysisd: ['Photos analysis', 'Photos', 'scanning the photo library'],
  photolibraryd: ['Photos analysis', 'Photos', 'scanning the photo library'],
  cloudd: ['iCloud', 'iCloud', 'syncing'],
  bird: ['iCloud', 'iCloud', 'syncing'],
  fileproviderd: ['iCloud', 'iCloud', 'syncing'],
  softwareupdated: ['Software Update', 'Update', 'downloading or preparing an update'],
  XprotectService: ['XProtect', 'XProtect', 'malware scan'],
  syspolicyd: ['Gatekeeper', 'Gatekpr', 'checking apps'],
  // Windows (process names come without .exe)
  System: ['Windows kernel', 'kernel', ''],
  'Memory Compression': ['Memory compression', 'Compress', 'Windows compressing RAM'],
  MsMpEng: ['Microsoft Defender', 'Defender', 'scanning files'],
  SearchIndexer: ['Windows Search', 'Search', 'indexing files'],
  dwm: ['Desktop Window Manager', 'DWM', 'draws everything on screen'],
  chrome: ['Google Chrome', 'Chrome', ''],
  msedge: ['Microsoft Edge', 'Edge', ''],
};

const appOf = (p) => { const m = /\/([^/]+)\.app\//.exec(p); return m ? m[1] : null; };
const shortOf = (name) => name.replace(/^(Google|Microsoft)\s+/, '');

function projectFromArgs(args) {
  const m = /(\/[^\s]*?)\/node_modules\//.exec(args || '');
  return m ? m[1] : null;
}

/** What a runtime process is running, in a few words: "next dev", "tsx",
 *  "workshop/dashboard.mjs", "-m http.server". */
function toolOf(args, base) {
  const t = (args || '').split(/\s+/).filter(Boolean);
  const bin = t.findIndex((s) => /\/node_modules\/\.bin\/[^/]+$/.test(s));
  if (bin >= 0) {
    const name = t[bin].split('/').pop();
    const next = t[bin + 1];
    return next && !next.startsWith('-') && !next.includes('/') && next.length < 16 ? `${name} ${next}` : name;
  }
  const mod = t.map((s) => /\/node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(s)).find(Boolean);
  if (mod) return mod[1];
  const m = t.indexOf('-m');
  if (m >= 0 && t[m + 1]) return `-m ${t[m + 1]}`;
  const script = t.slice(1).find((s) => !s.startsWith('-'));
  return script ? (script.length > 32 ? '…' + script.slice(-31) : script) : base;
}

// ---- Formatting ----
const GiB = 1024 ** 3;
function fmtMem(b) {
  return b >= GiB ? (b / GiB).toFixed(1) + ' GB' : Math.round(b / 1024 ** 2) + ' MB';
}
// Disk sizes in decimal units, as System Settings → Storage shows them.
function fmtDisk(b) {
  return b >= 1e12 ? (b / 1e12).toFixed(2) + ' TB' : b >= 10e9 ? Math.round(b / 1e9) + ' GB'
    : b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
}
function fmtRate(b) {
  return b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB/s' : b >= 1e6 ? Math.round(b / 1e6) + ' MB/s' : Math.round(b / 1e3) + ' KB/s';
}
const fmtPct = (p) => (p >= 10 ? Math.round(p) : p.toFixed(1)) + '%';

/** "7963:47.78", "1:02:03.45", "2-03:04:05.00" -> seconds. */
function cpuSeconds(s) {
  const [d, rest] = s.includes('-') ? s.split('-') : ['0', s];
  return rest.split(':').reduce((acc, v) => acc * 60 + parseFloat(v), 0) + Number(d) * 86400;
}

// ---- Child processes that answer one request per call ----
class LineHelper {
  /**
   * @param {string} cmd
   * @param {string[]} args
   * @param {string} end   what ends one reply on stdout
   */
  constructor(cmd, args, end) {
    this.cmd = cmd; this.args = args; this.end = end;
    this.child = null; this.buf = ''; this.pending = null; this.failures = 0; this.nextTry = 0;
  }
  _start() {
    if (this.child || Date.now() < this.nextTry) return !!this.child;
    try {
      this.child = spawn(this.cmd, this.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch (e) {
      this._fail(); return false;
    }
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => {
      this.buf += d;
      const i = this.buf.indexOf(this.end);
      if (i < 0) return;
      const reply = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + this.end.length);
      this._settle(reply);
    });
    this.child.on('error', () => this._died());
    this.child.on('exit', () => this._died());
    this.child.stdin.on('error', () => {});
    return true;
  }
  _fail() {
    // Back off after repeated failures so a broken helper is not respawned
    // every tick forever.
    this.failures++;
    this.nextTry = Date.now() + Math.min(300000, 5000 * 2 ** Math.min(6, this.failures));
  }
  _died() {
    if (!this.child) return;
    this.child = null; this.buf = '';
    this._fail();
    this._settle(null);
  }
  _settle(v) {
    const p = this.pending; this.pending = null;
    if (p) { clearTimeout(p.timer); p.resolve(v); }
    if (v != null) this.failures = 0;
  }
  request(line, timeout = 5000) {
    if (this.pending || !this._start()) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.stop(); resolve(null); }, timeout);
      this.pending = { resolve, timer };
      this.child.stdin.write(line + '\n');
    });
  }
  stop() {
    const c = this.child; this.child = null; this.buf = '';
    if (c) { try { c.kill(); } catch {} }
    this._settle(null);
  }
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, timeout: 5000, windowsHide: true },
      (err, out) => resolve(err ? '' : String(out)));
  });
}

// Per-process CPU and working set on Windows, from one PowerShell kept alive:
// starting PowerShell costs about a second of CPU, far too much to pay every tick.
const WIN_PS = `
$ErrorActionPreference = 'SilentlyContinue'
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $o = Get-Process | ForEach-Object { "$($_.Id)\`t$($_.ProcessName)\`t$([double]$_.CPU)\`t$($_.WorkingSet64)" }
  [Console]::Out.WriteLine(($o -join "\`n"))
  [Console]::Out.WriteLine('--END--')
  [Console]::Out.Flush()
}`;

// ---- The monitor ----
class SystemMonitor {
  /**
   * @param {object} o
   * @param {string} [o.helperPath]   hud-sysmon (macOS)
   * @param {() => string} [o.thermalState]   powerMonitor.getCurrentThermalState
   * @param {(state: object) => void} o.onUpdate
   */
  constructor({ helperPath, thermalState, onUpdate }) {
    this.helperPath = helperPath;
    this.thermalState = thermalState || (() => 'unknown');
    this.onUpdate = onUpdate;
    this.state = null;
    this.timer = null;
    this.busy = false;
    this.helper = null;
    this.prev = null;                 // last sample's raw counters
    this.ema = new Map();             // group key -> smoothed { cpu, gpu }
    this.argsCache = new Map();       // pid -> args
  }

  start() {
    if (this.timer) return;
    if (IS_MAC && this.helperPath && fs.existsSync(this.helperPath)) {
      this.helper = new LineHelper(this.helperPath, [], '\n');
    } else if (IS_WIN) {
      const enc = Buffer.from(WIN_PS, 'utf16le').toString('base64');
      this.helper = new LineHelper('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], '--END--');
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), INTERVAL);
  }

  stop() {
    clearInterval(this.timer); this.timer = null;
    if (this.helper) this.helper.stop();
    this.helper = null; this.prev = null; this.state = null;
    this.ema.clear(); this.argsCache.clear();
  }

  /** Take a sample now (also on the timer). Overlapping calls are dropped. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const s = await this._sample();
      if (s && this.timer) { this.state = s; if (this.onUpdate) this.onUpdate(s); }
    } catch (e) {
      console.log('[HUD] system sample failed:', e.message);
    } finally {
      this.busy = false;
    }
  }

  async _sample() {
    const now = Date.now();
    const cpus = os.cpus();
    const cpuTimes = cpus.reduce((a, c) => {
      const t = c.times; a.idle += t.idle; a.all += t.user + t.nice + t.sys + t.idle + t.irq; return a;
    }, { idle: 0, all: 0 });
    const disk = await this._disk();
    const raw = IS_MAC ? await this._macProcs() : IS_WIN ? await this._winProcs() : { procs: [] };

    const prev = this.prev;
    // A gap much longer than the interval means the machine slept: the deltas
    // would average a burst over hours. Start over from this sample.
    const fresh = !prev || now - prev.at > INTERVAL * 6;
    this.prev = { at: now, cpuTimes, procs: new Map(raw.procs.map((p) => [p.pid, p])),
                  gpuNs: raw.gpuNs || new Map() };
    if (fresh) return null;
    const dt = (now - prev.at) / 1000;
    const nCpu = cpus.length || 1;

    // Totals
    const dAll = cpuTimes.all - prev.cpuTimes.all;
    const cpuPct = dAll > 0 ? Math.max(0, Math.min(100, 100 * (1 - (cpuTimes.idle - prev.cpuTimes.idle) / dAll))) : 0;
    let mem;
    if (IS_MAC && raw.mem && raw.mem.freePct >= 0) {
      const m = raw.mem;
      mem = { pct: 100 - m.freePct, total: m.total, swapUsed: m.swapUsed,
              pressure: m.pressure >= 4 ? 'critical' : m.pressure >= 2 ? 'warn' : 'normal' };
    } else {
      const total = os.totalmem(), used = total - os.freemem();
      const pct = 100 * used / total;
      mem = { pct, total, swapUsed: null, pressure: byPct(pct, 85, 95) };
    }

    // Per group
    const groups = new Map();
    for (const p of raw.procs) {
      const g0 = p.group;
      let g = groups.get(g0.key);
      if (!g) { g = { ...g0, cpu: 0, mem: 0, gpuNs: 0, io: 0 }; groups.set(g0.key, g); }
      const q = prev.procs.get(p.pid);
      if (q && q.path === p.path) {
        g.cpu += Math.max(0, p.cpuSec - q.cpuSec) / dt / nCpu * 100;
        if (p.rd != null && q.rd != null) g.io += Math.max(0, p.rd - q.rd + p.wr - q.wr) / dt;
        const gn = raw.gpuNs && raw.gpuNs.get(p.pid), gq = prev.gpuNs.get(p.pid);
        if (gn != null && gq != null) g.gpuNs += Math.max(0, gn - gq);
      }
      g.mem += p.mem;
    }
    const gpuTotalNs = [...groups.values()].reduce((a, g) => a + g.gpuNs, 0);
    const gpuUtil = raw.gpuUtil != null && raw.gpuUtil >= 0 ? raw.gpuUtil : null;
    // Smooth CPU and GPU per group so the named culprit does not flicker
    // between two apps trading places tick to tick.
    const seen = new Set();
    for (const g of groups.values()) {
      const gpuPct = gpuUtil != null && gpuTotalNs > 0 ? gpuUtil * g.gpuNs / gpuTotalNs : 0;
      const e = this.ema.get(g.key);
      g.cpu = e ? e.cpu * 0.5 + g.cpu * 0.5 : g.cpu;
      g.gpu = e ? e.gpu * 0.5 + gpuPct * 0.5 : gpuPct;
      this.ema.set(g.key, { cpu: g.cpu, gpu: g.gpu });
      seen.add(g.key);
    }
    for (const k of this.ema.keys()) if (!seen.has(k)) this.ema.delete(k);

    const list = [...groups.values()];
    const top = (field, fmt, min, n = 3) => list.filter((g) => g[field] > min)
      .sort((a, b) => b[field] - a[field]).slice(0, n)
      .map((g) => ({ key: g.key, name: g.name, short: g.short, detail: g.detail,
                     value: g[field], text: fmt(g[field]), pids: g.pids.slice(0, 8) }));

    const cpu = { pct: cpuPct, severity: byPct(cpuPct, 70, 90), top: top('cpu', fmtPct, 0.3) };
    mem.severity = mem.pressure;
    mem.top = top('mem', fmtMem, 50 * 1024 ** 2);
    const gpu = gpuUtil == null ? null
      : { pct: gpuUtil, severity: byPct(gpuUtil, 70, 90), top: top('gpu', fmtPct, 0.5) };
    const io = IS_MAC ? { top: top('io', fmtRate, 200 * 1024) } : null;
    let heat = null;
    const ts = this.thermalState();
    if (IS_MAC) {
      const t = raw.temp || {};
      heat = { chip: t.chip, ssd: t.ssd, battery: t.battery, state: ts,
               severity: ts === 'serious' || ts === 'critical' ? 'critical' : ts === 'fair' ? 'warn' : 'normal' };
    }

    const s = { at: now, platform: process.platform, cpu, mem, gpu, disk, heat, io,
                cores: nCpu, helper: !!(this.helper && this.helper.child) };
    s.verdict = verdict(s, list);
    return s;
  }

  _disk() {
    return new Promise((resolve) => {
      if (typeof fs.statfs !== 'function') return resolve(null);
      fs.statfs(DISK_MOUNT, (err, st) => {
        if (err || !st.blocks) return resolve(null);
        const total = st.blocks * st.bsize, free = st.bavail * st.bsize;
        const freePct = 100 * free / total;
        resolve({ mount: DISK_MOUNT, total, free, usedPct: 100 - freePct,
                  severity: freePct < 10 ? 'critical' : freePct < 15 ? 'warn' : 'normal' });
      });
    });
  }

  async _macProcs() {
    const out = await run('/bin/ps', ['-Axo', 'pid=,ppid=,time=,rss=,comm=']);
    const procs = new Map();
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.+)$/.exec(line);
      if (!m) continue;
      const p = { pid: +m[1], ppid: +m[2], cpuSec: cpuSeconds(m[3]), rss: +m[4] * 1024, path: m[5] };
      p.base = path.basename(p.path);
      procs.set(p.pid, p);
    }
    // Runtimes and agent sessions are named by project: their arguments and
    // working directory say which one. Arguments do not change, so cache them.
    const named = [...procs.values()].filter((p) => AGENT[p.base] || RUNTIME.test(p.base));
    const need = named.filter((p) => !this.argsCache.has(p.pid)).map((p) => p.pid);
    if (need.length) {
      const a = await run('/bin/ps', ['-o', 'pid=,args=', '-p', need.join(',')]);
      for (const line of a.split('\n')) {
        const m = /^\s*(\d+)\s+(.*)$/.exec(line);
        if (m) this.argsCache.set(+m[1], m[2]);
      }
    }
    for (const pid of this.argsCache.keys()) if (!procs.has(pid)) this.argsCache.delete(pid);

    const h = this.helper ? await this.helper.request('s ' + named.map((p) => p.pid).join(' ')) : null;
    let info = {};
    try { info = h ? JSON.parse(h) : {}; } catch { info = {}; }
    const detail = new Map((info.procs || []).map(([pid, fp, rd, wr, resp]) => [pid, { fp, rd, wr, resp }]));
    const cwd = info.cwd || {};
    const gpuNs = new Map(((info.gpu && info.gpu.clients) || []).map(([pid, ns]) => [pid, ns]));

    const cache = new Map();
    const home = os.homedir();
    const projectGroup = (kind, p) => {
      const args = this.argsCache.get(p.pid) || '';
      let dir = projectFromArgs(p.path) || projectFromArgs(args);
      if (!dir) {
        const c = cwd[p.pid];
        if (c && c !== '/' && c !== home) dir = c;
      }
      const proj = dir ? path.basename(dir) : null;
      if (kind === 'agent') {
        const who = AGENT[p.base];
        return { key: `agent:${p.base}:${dir || p.pid}`, name: proj ? `${who} · ${proj}` : who,
                 short: proj || who.split(' ')[0], detail: dir ? dir.replace(home, '~') : '', kind: 'agent' };
      }
      const tool = toolOf(args, p.base);
      return { key: `rt:${dir || p.pid}`, name: proj ? `${proj} · ${tool.split(' ')[0]}` : tool,
               short: proj || p.base, detail: dir ? `${tool} — ${dir.replace(home, '~')}` : args.slice(0, 60),
               kind: 'dev' };
    };
    const groupOf = (p, depth = 0) => {
      if (cache.has(p.pid)) return cache.get(p.pid);
      let g = null;
      if (AGENT[p.base]) g = projectGroup('agent', p);
      else if (RUNTIME.test(p.base) || p.path.includes('/node_modules/')) g = projectGroup('dev', p);
      else if (appOf(p.path)) {
        const a = appOf(p.path);
        g = { key: 'app:' + a, name: a, short: shortOf(a), detail: '', kind: 'app' };
      } else {
        // A shell, git or ripgrep started by Claude Code or a dev server counts
        // toward it: walk up the parents, stopping at an app or launchd.
        const par = procs.get(p.ppid);
        if (par && par.pid > 1 && depth < 8
            && (AGENT[par.base] || RUNTIME.test(par.base) || (!appOf(par.path) && par.ppid > 1))) {
          const pg = groupOf(par, depth + 1);
          if (pg.kind === 'agent' || pg.kind === 'dev') g = pg;
        }
        // An XPC service or helper outside any bundle: file it under the app
        // macOS holds responsible for it (Claude's virtual machine -> Claude).
        const d = detail.get(p.pid);
        if (!g && d && d.resp > 0 && d.resp !== p.pid && procs.has(d.resp) && depth < 8) {
          const og = groupOf(procs.get(d.resp), depth + 1);
          if (og.kind !== 'bin') g = og;
        }
        if (!g) {
          const known = SYSTEM[p.base];
          g = known ? { key: 'sys:' + known[0], name: known[0], short: known[1], detail: known[2], kind: 'system' }
                    : { key: 'bin:' + p.base, name: p.base, short: p.base, detail: '', kind: 'bin' };
        }
      }
      cache.set(p.pid, g);
      return g;
    };

    // groupOf builds a fresh object per process; one shared object per key.
    const byKey = new Map();
    const list = [];
    for (const p of procs.values()) {
      const g0 = groupOf(p);
      let g = byKey.get(g0.key);
      if (!g) { g = { ...g0, pids: [] }; byKey.set(g0.key, g); }
      g.pids.push(p.pid);
      const d = detail.get(p.pid);
      list.push({ pid: p.pid, path: p.path, cpuSec: p.cpuSec, group: g,
                  mem: d ? d.fp : p.rss, rd: d ? d.rd : null, wr: d ? d.wr : null });
    }
    return { procs: list, mem: info.mem, temp: info.temp, gpuUtil: info.gpu ? info.gpu.util : null, gpuNs };
  }

  async _winProcs() {
    const out = this.helper ? await this.helper.request('s', 8000) : null;
    const list = [];
    const groups = new Map();
    for (const line of (out || '').split('\n')) {
      const [id, name, cpu, ws] = line.trim().split('\t');
      if (!id || !name) continue;
      const known = SYSTEM[name];
      const key = 'win:' + name.toLowerCase();
      let g = groups.get(key);
      if (!g) {
        g = known ? { key, name: known[0], short: known[1], detail: known[2], kind: 'system', pids: [] }
                  : { key, name, short: name, detail: '', kind: 'app', pids: [] };
        groups.set(key, g);
      }
      g.pids.push(+id);
      list.push({ pid: +id, path: name, cpuSec: parseFloat(cpu) || 0, mem: +ws || 0, rd: null, wr: null, group: g });
    }
    return { procs: list };
  }
}

/**
 * The one line that answers "why is it slow": the resource under the most
 * pressure, and who is behind it. Severity decides first; among equals, the
 * load right now (CPU, memory, GPU) wins.
 *
 * A full disk is a standing condition, not something happening this minute, so
 * it only takes the verdict once it is critical (under 10% free). A disk that
 * is merely tight shows amber in its own row and leaves the ring to whoever is
 * loading the machine now — otherwise a disk a little short of room would hold
 * the ring for weeks and hide the very thing it is there to show.
 */
function verdict(s, groups) {
  const cand = [
    { res: 'cpu', sev: s.cpu.severity, load: s.cpu.pct / 100 },
    { res: 'mem', sev: s.mem.severity, load: s.mem.pct / 100 },
  ];
  if (s.gpu) cand.push({ res: 'gpu', sev: s.gpu.severity, load: s.gpu.pct / 100 });
  if (s.heat && s.heat.severity !== 'normal') cand.push({ res: 'heat', sev: s.heat.severity, load: 1 });
  if (s.disk && s.disk.severity === 'critical') cand.push({ res: 'disk', sev: 'critical', load: 0 });
  cand.sort((a, b) => RANK[b.sev] - RANK[a.sev] || b.load - a.load);
  const w = cand[0];
  const v = { resource: w.res, severity: w.sev, culprit: null, text: '' };
  const first = (r) => (s[r] && s[r].top && s[r].top[0]) || null;
  if (w.res === 'disk') {
    v.value = s.disk.usedPct;
    v.ring = fmtDisk(s.disk.free);
    v.text = w.sev === 'normal' ? 'All clear' : `Disk almost full — ${fmtDisk(s.disk.free)} left`;
    return v;
  }
  if (w.res === 'heat') {
    // Heat has no owner of its own: blame whoever is burning the most CPU+GPU.
    const hot = groups.slice().sort((a, b) => (b.cpu + b.gpu) - (a.cpu + a.gpu))[0];
    v.value = s.heat.chip || 100;
    v.culprit = hot ? { name: hot.name, short: hot.short } : null;
    v.ring = hot ? hot.short : (s.heat.chip ? Math.round(s.heat.chip) + '°' : 'hot');
    v.text = `Running hot and slowing down${hot ? ` — mostly ${hot.name}` : ''}`;
    return v;
  }
  const r = s[w.res], c = first(w.res);
  const noun = { cpu: 'CPU', mem: 'Memory', gpu: 'GPU' }[w.res];
  v.value = r.pct;
  v.culprit = c ? { name: c.name, short: c.short, text: c.text } : null;
  v.ring = c ? c.short : fmtPct(r.pct);
  if (w.sev === 'normal') {
    v.text = c ? `All clear · busiest: ${c.name} (${noun.toLowerCase()} ${c.text})` : 'All clear';
  } else {
    const what = { cpu: w.sev === 'critical' ? 'CPU is maxed out' : 'CPU is busy',
                   mem: w.sev === 'critical' ? 'Memory is critically low' : 'Memory is under pressure',
                   gpu: w.sev === 'critical' ? 'GPU is maxed out' : 'GPU is busy' }[w.res];
    v.text = c ? `${what} — ${c.name} uses ${c.text}` : what;
  }
  return v;
}

module.exports = { SystemMonitor, fmtMem, fmtDisk, fmtRate, fmtPct, _test: { toolOf, projectFromArgs, cpuSeconds, verdict } };
