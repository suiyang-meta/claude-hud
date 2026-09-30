#!/usr/bin/env node
/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/*
 * Price-table check (the local half of the weekly price check).
 *
 *   node scripts/check-model-prices.js [--days 14] [--simulate-missing <model-id>]
 *
 * Prints JSON with:
 *   table   every row of widget/usage/LocalUsage.js PRICE as $/MTok:
 *           input, output, cacheRead, cacheWrite5m, cacheWrite1h
 *   seen    model ids found in ~/.claude/projects transcripts modified in the last
 *           --days days, with how each is priced ('exact' | 'tier' | 'none') and a count
 *   missing the seen ids that are not priced exactly
 * Exit code 1 when anything is missing, 0 otherwise.
 *
 * Only model id strings are read from the transcripts — no prompt or reply text.
 * --simulate-missing deletes one row before checking, to prove the check fires.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../widget/usage/LocalUsage.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DAYS = +opt('--days', 14);
const sim = opt('--simulate-missing', null);
if (sim) delete L.PRICE[sim];

const table = {};
for (const [id, p] of Object.entries(L.PRICE)) {
  const read = p[2] != null ? p[2] : L.W_CACHE_READ;
  table[id] = { input: p[0], output: p[1], cacheRead: +(p[0] * read).toFixed(4),
                cacheWrite5m: +(p[0] * L.W_CACHE_5M).toFixed(4), cacheWrite1h: +(p[0] * L.W_CACHE_1H).toFixed(4) };
}

const root = path.join(os.homedir(), '.claude', 'projects');
const since = Date.now() - DAYS * 864e5;
const counts = {};
const RE = /"model":"(claude-[a-z0-9.-]+(?:\[[^\]"]*\])?)"/g;
(function walk(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.jsonl')) {
      let st; try { st = fs.statSync(f); } catch { continue; }
      if (st.mtimeMs < since) continue;
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(RE)) counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  }
})(root);

const seen = Object.entries(counts).sort((a, b) => b[1] - a[1])
  .map(([id, n]) => ({ id, records: n, priced: L.priceKind(id) }));
const missing = seen.filter((s) => s.priced !== 'exact');
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), days: DAYS, simulated: sim, table, seen, missing }, null, 2));
process.exit(missing.length ? 1 : 0);
