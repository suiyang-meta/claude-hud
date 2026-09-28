'use strict';
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * DiskScan — what is filling the disk (macOS). Runs only when asked.
 *
 * Not a full-disk walk: that takes minutes on a large disk and trips macOS's
 * privacy prompts all over the place. Instead it measures the places that
 * usually grow without anyone noticing:
 *   - build output and dependencies in code folders (node_modules, .next,
 *     dist, .venv, target, ...), totalled per project
 *   - caches, Trash, Downloads, Xcode and simulator data, Docker, model stores
 * and says how much of the used space those account for, so the rest is not
 * mistaken for "nothing else".
 *
 * Reading ~/Documents and ~/Downloads makes macOS ask once for each. Folders
 * it may not read (Trash, without Full Disk Access) are reported as such.
 * Read-only: it measures, it never deletes.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const CODE_ROOTS = ['Documents/Code', 'Documents/GitHub', 'Code', 'code', 'Developer', 'Projects',
                    'projects', 'dev', 'src', 'workspace', 'GitHub', 'git', 'repos']
  .map((r) => path.join(HOME, r));
// Folder names that hold what a build or install produced, not the project itself.
const ARTIFACTS = ['node_modules', '.next', '.turbo', '.nuxt', '.svelte-kit', '.parcel-cache',
                   '.expo', '.vercel', 'dist', '.venv', 'venv', 'target', '.gradle', 'DerivedData'];
const PLACES = [
  ['Trash', '.Trash'],
  ['Downloads', 'Downloads'],
  ['App caches', 'Library/Caches'],
  ['Claude app data', 'Library/Application Support/Claude'],
  ['Chrome profile', 'Library/Application Support/Google/Chrome'],
  ['Xcode build data', 'Library/Developer/Xcode/DerivedData'],
  ['Xcode device support', 'Library/Developer/Xcode/iOS DeviceSupport'],
  ['iOS simulators', 'Library/Developer/CoreSimulator'],
  ['Docker', 'Library/Containers/com.docker.docker'],
  ['npm cache', '.npm'],
  ['pnpm store', 'Library/pnpm'],
  ['Other caches (~/.cache)', '.cache'],
  ['Ollama models', '.ollama'],
  ['iPhone backups', 'Library/Application Support/MobileSync/Backup'],
].map(([label, rel]) => ({ label, path: path.join(HOME, rel) }));

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout },
      (err, stdout, stderr) => resolve({ out: String(stdout || ''), err: String(stderr || ''), failed: !!err }));
  });
}

/**
 * @param {(msg: string) => void} [onProgress]
 * @returns {Promise<{at:number, items:Array, measured:number, used:number|null, unreadable:string[]}>}
 */
async function scanDisk(onProgress = () => {}) {
  const roots = CODE_ROOTS.filter(isDir)
    // ~/Documents/Code and ~/Code can be the same folder through a link.
    .filter((r, i, a) => a.findIndex((o) => fs.realpathSync(o) === fs.realpathSync(r)) === i);
  let found = [];
  if (roots.length) {
    onProgress('Looking through code folders…');
    const names = ARTIFACTS.flatMap((n, i) => (i ? ['-o', '-name', n] : ['-name', n]));
    const { out } = await run('/usr/bin/find',
      [...roots, '-maxdepth', '6', '-type', 'd', '(', '-name', '.git', '-prune', '-o',
       '(', ...names, ')', '-prune', '-print', ')'], 60000);
    found = out.split('\n').filter(Boolean);
  }
  const places = PLACES.filter((p) => isDir(p.path));
  const all = [...found, ...places.map((p) => p.path)];
  onProgress(`Measuring ${all.length} folders…`);
  const { out, err } = await run('/usr/bin/du', ['-sk', ...all], 180000);
  const size = new Map();
  for (const line of out.split('\n')) {
    const m = /^(\d+)\t(.+)$/.exec(line);
    if (m) size.set(m[2], Number(m[1]) * 1024);
  }
  // du keeps going past a folder it may not read and prints what it could
  // see (often 0), so its complaints decide which numbers are not real.
  const denied = new Set();
  for (const line of err.split('\n')) {
    const m = /^du: (.+?): (Operation not permitted|Permission denied)/.exec(line);
    if (m) denied.add(m[1]);
  }
  const blocked = (p) => [...denied].some((d) => d === p || d.startsWith(p + '/'));

  const items = [];
  const unreadable = [];
  // One row per project: everything under a code root's first-level folder.
  const perProject = new Map();
  for (const f of found) {
    const root = roots.find((r) => f.startsWith(r + '/'));
    const proj = root ? path.join(root, path.relative(root, f).split(path.sep)[0]) : path.dirname(f);
    const e = perProject.get(proj) || { bytes: 0, kinds: new Set() };
    e.bytes += size.get(f) || 0;
    e.kinds.add(path.basename(f));
    perProject.set(proj, e);
  }
  for (const [proj, e] of perProject) {
    items.push({ label: path.basename(proj), detail: [...e.kinds].join(' · '), path: proj,
                 bytes: e.bytes, kind: 'dev' });
  }
  for (const p of places) {
    if (blocked(p.path) && !(size.get(p.path) > 0)) { unreadable.push(p.label); continue; }
    items.push({ label: p.label, detail: p.path.replace(HOME, '~'), path: p.path,
                 bytes: size.get(p.path) || 0, kind: 'place' });
  }
  items.sort((a, b) => b.bytes - a.bytes);
  const measured = items.reduce((a, i) => a + i.bytes, 0);
  let used = null;
  try {
    const st = fs.statfsSync ? fs.statfsSync('/System/Volumes/Data') : null;
    if (st) used = (st.blocks - st.bavail) * st.bsize;
  } catch {}
  return { at: Date.now(), items: items.filter((i) => i.bytes >= 100e6).slice(0, 16),
           measured, used, unreadable };
}

module.exports = { scanDisk };
