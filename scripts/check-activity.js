#!/usr/bin/env node
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/*
 * Activity-card check: do the heatmap's numbers match the transcripts?
 *
 *   node scripts/check-activity.js [--cache <usage-cache.json>] [YYYY-MM-DD ...]
 *
 * Counts messages, sessions and the peak hour straight from
 * ~/.claude/projects with an independent copy of the Claude desktop app's own
 * rules (its getCodeStats, which drew the original card), then builds the
 * HUD's LocalUsageScanner from nothing in a temporary folder and compares the
 * two day by day. Dates given are printed side by side as spot checks.
 *
 * Today is not compared: sessions still being written move between the two
 * passes. Tool calls are not compared either: the HUD also counts workflow agents
 * (subagents/workflows/), which the desktop app never listed, so its figure is
 * higher by design — and the card does not show it.
 *
 * --cache compares against an existing cache instead (the installed app's is
 * ~/Library/Application Support/claude-hud/usage-cache.json), read only, never
 * refreshed: a long-lived cache is where history the app keeps for deleted or
 * moved transcripts lives, and a fresh cache cannot show what that gets wrong
 * (2026-10-17: a renamed project folder was counted twice). Days the app has
 * not read since the cache was last saved will differ; pass the days to check.
 *
 * Reads every transcript twice (about 40 s for 8 GB). Writes only to a
 * temporary folder, removed afterwards. Exit code 1 on any mismatch.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LocalUsageScanner } = require('../widget/usage/LocalUsage.js');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// The desktop app's file list: a session's transcript in its project folder,
// its subagents in <session>/subagents/agent-*.jsonl.
function listFiles() {
  const out = [];
  let projects = [];
  try { projects = fs.readdirSync(ROOT, { withFileTypes: true }); } catch { return out; }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const dir = path.join(ROOT, p.name);
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl') && !e.name.includes('.superseded-')) {
        out.push({ file: path.join(dir, e.name), sub: false });
      } else if (e.isDirectory()) {
        const sd = path.join(dir, e.name, 'subagents');
        let subs = [];
        try { subs = fs.readdirSync(sd, { withFileTypes: true }); } catch { /* none */ }
        for (const s of subs) {
          if (s.isFile() && s.name.endsWith('.jsonl') && s.name.startsWith('agent-')) out.push({ file: path.join(sd, s.name), sub: true });
        }
      }
    }
  }
  return out;
}

// One transcript, per the desktop app: every user/assistant row is a message,
// the first one is when the session started. Lines split on \n only, as the
// desktop app does (readline in newer Node also splits at U+2028).
async function summarize(file, sub) {
  let first = null;
  const days = {};
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length > 16777216) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || typeof r !== 'object' || (r.type !== 'user' && r.type !== 'assistant')) continue;
    if (r.userType === 'ant' || (!sub && r.isSidechain) || !r.timestamp) continue;
    const t = new Date(r.timestamp);
    if (isNaN(t.getTime())) continue;
    if (first === null) first = r.timestamp;
    const k = localDay(t);
    days[k] = (days[k] || 0) + 1;
  }
  return first === null ? null : { first, days };
}

const argv = process.argv.slice(2);
const ci = argv.indexOf('--cache');
const CACHE = ci >= 0 ? argv.splice(ci, 2)[1] : null;

(async () => {
  const ref = new Map();
  const hours = new Array(24).fill(0);
  const row = (d) => ref.get(d) || (ref.set(d, { messages: 0, sessions: 0 }), ref.get(d));
  for (const { file, sub } of listFiles()) {
    if (sub || fs.statSync(file).size > 1024 ** 3) continue;   // subagents add no messages or sessions
    const s = await summarize(file, sub);
    if (!s) continue;
    const t = new Date(s.first);
    row(localDay(t)).sessions++;
    hours[t.getHours()]++;
    for (const [d, n] of Object.entries(s.days)) row(d).messages += n;
  }

  let act;
  if (CACHE) {
    act = new LocalUsageScanner(CACHE).activity();     // read only: no refresh(), nothing saved
  } else {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hud-activity-check-'));
    try {
      const sc = new LocalUsageScanner(path.join(tmp, 'usage-cache.json'));
      await sc.refresh();
      act = sc.stats().activity;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const hud = new Map(act.days.map((d) => [d.date, d]));

  let bad = 0;
  const today = localDay(new Date());
  for (const d of [...new Set([...ref.keys(), ...hud.keys()])].sort()) {
    if (d >= today) continue;
    const a = ref.get(d) || {}, b = hud.get(d) || {};
    for (const k of ['messages', 'sessions']) {
      if ((a[k] || 0) !== (b[k] || 0)) { bad++; console.log(`MISMATCH ${d} ${k}: transcripts ${a[k] || 0}, HUD ${b[k] || 0}`); }
    }
  }
  const peak = Math.max(...hours);
  const refPeak = peak > 0 ? hours.indexOf(peak) : null;
  if (refPeak !== act.peakHour) { bad++; console.log(`MISMATCH peak hour: transcripts ${refPeak}, HUD ${act.peakHour}`); }
  for (const d of argv) {
    const a = ref.get(d) || {}, b = hud.get(d) || {};
    console.log(`${d}  messages ${a.messages || 0} / ${b.messages || 0}   sessions ${a.sessions || 0} / ${b.sessions || 0}   (transcripts / HUD)`);
  }
  const sum = (m, k) => [...m.values()].reduce((s, x) => s + (x[k] || 0), 0);
  console.log(`${ref.size} active days · messages ${sum(ref, 'messages')} / ${sum(hud, 'messages')} · sessions ${sum(ref, 'sessions')} / ${sum(hud, 'sessions')} · peak hour ${refPeak} / ${act.peakHour}`);
  console.log(bad ? `${bad} mismatch(es)` : 'all days match');
  process.exit(bad ? 1 : 0);
})();
