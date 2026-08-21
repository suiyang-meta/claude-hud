'use strict';
/**
 * LocalUsage — token + cost stats from Claude Code's own transcripts.
 *
 * Source of truth is ~/.claude/projects/**\/*.jsonl. Everything here is derived
 * from files already on this machine; nothing leaves it.
 *
 * Two traps this module exists to get right (both verified against real data):
 *
 *  1. DEDUP. A single API call is written to the transcript several times as it
 *     streams. Those rows share a requestId; input/cache stay fixed while
 *     output_tokens grows. Keeping the *first* row undercounts output by ~99%
 *     on affected calls, so we keep the row with the largest output_tokens.
 *     requestIds are only unique per file, hence the (file, requestId) key.
 *
 *  2. WEIGHTING. Raw token totals are meaningless because cache_read dominates
 *     volume (~453M of 460M on a busy day) but bills at a tenth. We fold the
 *     price multipliers in so the dollar figure reflects what this usage would
 *     actually cost at API list price.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const ROOT = path.join(os.homedir(), '.claude', 'projects');

// Cache-pricing multipliers, relative to base input price (Anthropic docs).
const W_CACHE_READ = 0.1;    // cache hit
const W_CACHE_1H   = 2.0;    // 1-hour TTL write — 96% of this user's writes
const W_CACHE_5M   = 1.25;   // 5-minute TTL write

// USD per 1M tokens [input, output]. List price, checked 2026-06-24.
// Unknown models still count tokens; they just contribute $0.
const PRICE = {
  'claude-fable-5':            [10, 50],
  'claude-mythos-5':           [10, 50],
  'claude-opus-5':             [5, 25],
  'claude-opus-4-8':           [5, 25],
  'claude-opus-4-7':           [5, 25],
  'claude-opus-4-6':           [5, 25],
  'claude-sonnet-5':           [3, 15],
  'claude-sonnet-4-6':         [3, 15],
  'claude-haiku-4-5-20251001': [1, 5],
  'claude-haiku-4-5':          [1, 5],
};

const EMPTY = () => ({ input: 0, output: 0, cache1h: 0, cache5m: 0, cacheRead: 0 });

function addInto(dst, src) {
  dst.input += src.input; dst.output += src.output;
  dst.cache1h += src.cache1h; dst.cache5m += src.cache5m;
  dst.cacheRead += src.cacheRead;
}

/** Price-weighted input-equivalent tokens. */
function weightedInput(b) {
  return b.input + b.cache1h * W_CACHE_1H + b.cache5m * W_CACHE_5M + b.cacheRead * W_CACHE_READ;
}

function costUSD(model, b) {
  const p = PRICE[model];
  if (!p) return 0;
  return (weightedInput(b) / 1e6) * p[0] + (b.output / 1e6) * p[1];
}

/** Raw token count, no weighting — the honest "how many tokens" number. */
function rawTokens(b) {
  return b.input + b.output + b.cache1h + b.cache5m + b.cacheRead;
}

function localDayKey(iso, tzOffsetMinutes) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

/**
 * Scan one transcript. Returns { [dayKey]: { [model]: bucket } }.
 * Streams line-by-line — some transcripts are tens of MB.
 */
async function scanFile(file, tzOffsetMinutes) {
  const best = new Map();   // requestId -> {model, day, usage-ish, output}
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line || line.charCodeAt(0) !== 123 /* { */) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.type !== 'assistant') continue;
    const msg = o.message;
    if (!msg || !msg.usage || !o.timestamp) continue;
    const u = msg.usage;

    const key = o.requestId || ('uuid:' + o.uuid);
    const out = u.output_tokens || 0;
    const prev = best.get(key);
    if (prev && prev.output >= out) continue;      // keep the largest-output row

    const cc = u.cache_creation || null;
    let c1h, c5m;
    if (cc && (cc.ephemeral_1h_input_tokens != null || cc.ephemeral_5m_input_tokens != null)) {
      c1h = cc.ephemeral_1h_input_tokens || 0;
      c5m = cc.ephemeral_5m_input_tokens || 0;
    } else {
      c1h = u.cache_creation_input_tokens || 0;    // no split available; Claude Code defaults to 1h
      c5m = 0;
    }

    best.set(key, {
      output: out,
      model: msg.model || 'unknown',
      day: localDayKey(o.timestamp, tzOffsetMinutes),
      b: {
        input: u.input_tokens || 0,
        output: out,
        cache1h: c1h,
        cache5m: c5m,
        cacheRead: u.cache_read_input_tokens || 0,
      },
    });
  }

  const days = {};
  for (const r of best.values()) {
    if (!r.day) continue;
    const byModel = days[r.day] || (days[r.day] = {});
    const bucket = byModel[r.model] || (byModel[r.model] = EMPTY());
    addInto(bucket, r.b);
  }
  return days;
}

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

/**
 * Incremental scanner. Re-reads a transcript only when its mtime/size changed;
 * historical sessions are frozen, so steady-state cost is near zero.
 */
class LocalUsageScanner {
  constructor(cachePath, tzOffsetMinutes = -new Date().getTimezoneOffset()) {
    this.cachePath = cachePath;
    this.tz = tzOffsetMinutes;
    this.cache = { version: 1, files: {} };
    try {
      const c = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (c && c.version === 1 && c.files) this.cache = c;
    } catch { /* cold start */ }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify(this.cache));
    } catch { /* cache is an optimization, never fatal */ }
  }

  async refresh() {
    const files = walk(ROOT);
    const live = new Set(files);
    let rescanned = 0;

    for (const f of files) {
      let st;
      try { st = fs.statSync(f); } catch { continue; }
      const hit = this.cache.files[f];
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) continue;
      this.cache.files[f] = { mtimeMs: st.mtimeMs, size: st.size, days: await scanFile(f, this.tz) };
      rescanned++;
    }
    for (const f of Object.keys(this.cache.files)) {
      if (!live.has(f)) delete this.cache.files[f];   // deleted transcript
    }
    this.save();
    return { files: files.length, rescanned };
  }

  /** Merge every cached file into { [day]: { [model]: bucket } }. */
  merged() {
    const all = {};
    for (const rec of Object.values(this.cache.files)) {
      for (const [day, byModel] of Object.entries(rec.days || {})) {
        const dst = all[day] || (all[day] = {});
        for (const [model, b] of Object.entries(byModel)) {
          const cur = dst[model] || (dst[model] = EMPTY());
          addInto(cur, b);
        }
      }
    }
    return all;
  }

  /** Everything the HUD renders, in one pass. */
  stats(todayKey = new Date(Date.now() + this.tz * 60000).toISOString().slice(0, 10)) {
    const all = this.merged();
    const dayKeys = Object.keys(all).sort();

    const sumRange = (fromKey) => {
      const total = EMPTY();
      const byModel = {};
      let usd = 0;
      for (const [day, models] of Object.entries(all)) {
        if (day < fromKey || day > todayKey) continue;
        for (const [model, b] of Object.entries(models)) {
          addInto(total, b);
          const m = byModel[model] || (byModel[model] = EMPTY());
          addInto(m, b);
          usd += costUSD(model, b);
        }
      }
      return { total, byModel, usd };
    };

    const shift = (days) => {
      const d = new Date(todayKey + 'T00:00:00Z');
      d.setUTCDate(d.getUTCDate() - days);
      return d.toISOString().slice(0, 10);
    };

    const today = sumRange(todayKey);
    const week = sumRange(shift(6));
    const month = sumRange(shift(29));
    const allTime = sumRange('0000-00-00');

    // 30-day series, oldest first, zero-filled so the bar chart has no gaps.
    const series = [];
    for (let i = 29; i >= 0; i--) {
      const key = shift(i);
      const models = all[key] || {};
      const b = EMPTY();
      let usd = 0;
      for (const [model, mb] of Object.entries(models)) { addInto(b, mb); usd += costUSD(model, mb); }
      series.push({ day: key, tokens: rawTokens(b), weighted: weightedInput(b), usd });
    }

    const modelRows = Object.entries(week.byModel)
      .map(([model, b]) => ({ model, tokens: rawTokens(b), weighted: weightedInput(b), usd: costUSD(model, b) }))
      .filter(r => r.tokens > 0)
      .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens);

    return {
      today:   { tokens: rawTokens(today.total),  weighted: weightedInput(today.total),  usd: today.usd },
      week:    { tokens: rawTokens(week.total),   weighted: weightedInput(week.total),   usd: week.usd },
      month:   { tokens: rawTokens(month.total),  weighted: weightedInput(month.total),  usd: month.usd },
      allTime: { tokens: rawTokens(allTime.total), weighted: weightedInput(allTime.total), usd: allTime.usd,
                 firstDay: dayKeys[0] || null },
      byModel: modelRows,
      series,
    };
  }
}

module.exports = { LocalUsageScanner, PRICE, W_CACHE_READ, W_CACHE_1H, W_CACHE_5M };
