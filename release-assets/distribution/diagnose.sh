#!/bin/bash
# HUD for Claude — diagnostic (macOS).
#
# Answers one question: why do the HUD's token numbers differ from what you
# expect? Runs inside the installed HUD's own runtime, so it needs no Python or
# Node on this Mac, and it exercises the exact scanner the app ships with.
#
# Prints counts, dates and versions only — never conversation text, credentials
# or project names — so the output is safe to paste to whoever sent you the app.
set -u
APP=""
for a in "/Applications/HUD for Claude.app" "$HOME/Applications/HUD for Claude.app"; do
  [ -x "$a/Contents/MacOS/HUD for Claude" ] && { APP="$a"; break; }
done
if [ -z "$APP" ]; then
  echo "找不到 HUD for Claude —— /Applications 里没有它，请先安装。"
  exit 1
fi
DIR="$(mktemp -d -t hud-diagnose)"
trap 'rm -rf "$DIR"' EXIT
cat > "$DIR/diagnose.js" <<'JSEOF'
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const readline = require('readline');

const HOME = os.homedir();
const ME = os.userInfo();
const ASAR = path.join(process.env.HUD_APP, 'Contents', 'Resources', 'app.asar');
const CACHE = path.join(HOME, 'Library', 'Application Support', 'claude-hud', 'usage-cache.json');
const TZ = -new Date().getTimezoneOffset();
const DAY = 864e5;

const tilde = p => (p && p.startsWith(HOME)) ? '~' + p.slice(HOME.length) : p;
const dayKey = ms => new Date(ms + TZ * 60000).toISOString().slice(0, 10);
const two = n => String(n).padStart(2, '0');
const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const fmtTok = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
// CJK glyphs take two terminal columns; count them that way so columns line up.
const width = s => [...String(s)].reduce((n, c) => n + (c.codePointAt(0) > 0x2E7F ? 2 : 1), 0);
const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - width(s)));
const row = (k, v) => console.log('  ' + pad(k, 34) + v);
const head = t => console.log('\n' + t);
const run = (cmd, args) => { try { return (cp.spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 }).stdout || '').trim(); } catch { return ''; } };
const readJSON = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

function walk(dir, out = []) {
  let es; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

// Open first, so a permissions or missing-file error rejects here instead of
// depending on readline to forward it.
async function eachLine(file, fn) {
  const fh = await fs.promises.open(file, 'r');
  const rl = readline.createInterface({ input: fh.createReadStream({ encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const ln of rl) fn(ln);
}

function claudeVersion() {
  for (const bin of ['claude', path.join(HOME, '.local/bin/claude'), '/opt/homebrew/bin/claude',
                     '/usr/local/bin/claude', path.join(HOME, '.claude/local/claude')]) {
    const v = run(bin, ['--version']);
    if (v) return v.split('\n')[0];
  }
  return '找不到 claude 命令';
}

async function inspect(dir) {
  const r = { exists: fs.existsSync(dir), files: [], newest: 0, oldest: 0, unreadable: 0,
              foreignOwners: new Set(), perDay: {}, lines: 0, asst: 0, usable: 0 };
  if (!r.exists) return r;
  r.files = walk(dir);
  const since = Date.now() - 7 * DAY;
  for (const f of r.files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (!r.newest || st.mtimeMs > r.newest) r.newest = st.mtimeMs;
    if (!r.oldest || st.mtimeMs < r.oldest) r.oldest = st.mtimeMs;
    if (st.uid !== ME.uid) r.foreignOwners.add(st.uid === 0 ? 'root' : 'uid ' + st.uid);
    try { fs.accessSync(f, fs.constants.R_OK); } catch { r.unreadable++; continue; }
    if (st.mtimeMs < since) continue;
    // Same acceptance rule as the HUD's scanner: an assistant record with usage
    // and a timestamp, deduplicated by requestId keeping the largest output.
    const best = new Map();
    try {
      await eachLine(f, ln => {
        if (!ln) return;
        r.lines++;
        let o; try { o = JSON.parse(ln); } catch { return; }
        if (o.type !== 'assistant') return;
        r.asst++;
        const u = o.message && o.message.usage;
        if (!u || !o.timestamp) return;
        r.usable++;
        const k = o.requestId || ('u:' + o.uuid);
        const out = u.output_tokens || 0;
        const prev = best.get(k);
        if (prev && prev.out >= out) return;
        best.set(k, { out, day: dayKey(Date.parse(o.timestamp)),
          tok: (u.input_tokens || 0) + out + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) });
      });
    } catch { r.unreadable++; continue; }
    for (const b of best.values()) {
      const d = r.perDay[b.day] || (r.perDay[b.day] = { calls: 0, tokens: 0 });
      d.calls++; d.tokens += b.tok;
    }
  }
  return r;
}

// Only days inside the 7-day window count: a recently touched file can still
// hold older records, and those must not make a quiet week look busy.
const WINDOW = new Set(Array.from({ length: 7 }, (_, i) => dayKey(Date.now() - i * DAY)));
const recentCalls = r => Object.entries(r.perDay || {})
  .reduce((s, [d, x]) => s + (WINDOW.has(d) ? x.calls : 0), 0);

(async () => {
  console.log('HUD for Claude 诊断报告 · ' + stamp(Date.now()));
  console.log('只含数量、日期、版本 —— 没有对话内容、没有凭证、没有项目名。');

  head('[1] 版本');
  const pkg = readJSON(path.join(ASAR, 'package.json'));
  row('HUD for Claude', pkg ? pkg.version : '?');
  row('Claude Code', claudeVersion());
  row('macOS', run('sw_vers', ['-productVersion']) || '?');

  head('[2] Claude Code 把对话记录（transcripts）写在哪');
  const envDir = process.env.CLAUDE_CONFIG_DIR || '';
  const lcDir = run('launchctl', ['getenv', 'CLAUDE_CONFIG_DIR']);
  const rcHits = ['.zshrc', '.zprofile', '.zshenv', '.bashrc', '.bash_profile', '.profile', '.config/fish/config.fish']
    .filter(f => { try { return fs.readFileSync(path.join(HOME, f), 'utf8').includes('CLAUDE_CONFIG_DIR'); } catch { return false; } });
  row('CLAUDE_CONFIG_DIR（终端里）', envDir ? tilde(envDir) : '没设');
  row('写在哪个 shell 配置里', rcHits.length ? rcHits.map(f => '~/' + f).join(', ') : '都没有');
  row('CLAUDE_CONFIG_DIR（launchctl）', lcDir ? tilde(lcDir) : '没设');

  const roots = [];
  const addRoot = (label, dir) => { if (dir && !roots.some(r => r.dir === dir)) roots.push({ label, dir }); };
  addRoot('默认位置', path.join(HOME, '.claude', 'projects'));
  if (envDir) addRoot('CLAUDE_CONFIG_DIR', path.join(envDir, 'projects'));
  if (lcDir) addRoot('launchctl 的目录', path.join(lcDir, 'projects'));
  addRoot('旧版位置', path.join(HOME, '.config', 'claude', 'projects'));
  for (const r of roots) Object.assign(r, await inspect(r.dir));

  for (const r of roots) {
    console.log('');
    row(r.label, tilde(r.dir) + (r.exists ? '' : '  （不存在）'));
    if (!r.exists) continue;
    row('  记录文件', r.files.length + ' 个');
    if (r.files.length) row('  最旧 / 最新', stamp(r.oldest) + '  /  ' + stamp(r.newest));
    if (r.unreadable) row('  读不了的', r.unreadable + ' 个');
    if (r.foreignOwners.size) row('  不属于你的', [...r.foreignOwners].join(', '));
  }

  head('[3] 最近 7 天，这台 Mac 上每天的 Claude Code 调用');
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(dayKey(Date.now() - i * DAY));
  const active = roots.filter(r => r.exists && r.files.length);
  if (!active.length) console.log('  （哪个位置都没有记录文件）');
  else {
    console.log('  ' + pad('日期', 12) + active.map(r => pad(r.label, 24)).join(''));
    for (const d of days) {
      console.log('  ' + pad(d, 12) + active.map(r => {
        const x = r.perDay[d];
        return pad(x ? `${x.calls} 次 · ${fmtTok(x.tokens)}` : '—', 24);
      }).join(''));
    }
  }

  head('[4] 记录格式 HUD 读不读得懂（近 7 天）');
  for (const r of active) row(r.label, `${r.lines} 行 · assistant ${r.asst} 条 · 其中带用量 ${r.usable} 条`);

  head('[5] 保留期（Claude Code 会定期删掉旧记录）');
  const cfgHome = envDir || path.join(HOME, '.claude');
  const s1 = readJSON(path.join(cfgHome, 'settings.json')) || {};
  const s2 = readJSON(path.join(cfgHome, 'settings.local.json')) || {};
  const keep = s2.cleanupPeriodDays != null ? s2.cleanupPeriodDays : s1.cleanupPeriodDays;
  const keepDays = keep == null ? 30 : keep;
  row('cleanupPeriodDays', keep != null ? keep + ' 天' : '没设 → 默认 30 天');

  head('[6] HUD 自己看到的');
  const procs = run('ps', ['-Ao', 'pid=,lstart=,comm=']).split('\n')
    .filter(l => l.trimEnd().endsWith('/Contents/MacOS/HUD for Claude'))
    .filter(l => parseInt(l, 10) !== process.pid);
  row('HUD 在跑吗', procs.length ? '在跑，启动于 ' + procs[0].trim().split(/\s+/).slice(1, 6).join(' ') : '没在跑');

  let lib = null, fresh = null, freshErr = null, shown = null, cacheInfo = null;
  try { lib = require(path.join(ASAR, 'usage', 'LocalUsage.js')); } catch (e) { row('载入 HUD 的扫描器', '失败：' + e.message); }
  if (lib) {
    const tmp = path.join(os.tmpdir(), `hud-diag-${process.pid}.json`);
    try {
      const sc = new lib.LocalUsageScanner(tmp);
      await sc.refresh();
      fresh = sc.stats();
    } catch (e) { freshErr = e.code || e.message; }
    try { fs.unlinkSync(tmp); } catch {}
    if (fs.existsSync(CACHE)) {
      const copy = path.join(os.tmpdir(), `hud-diag-cache-${process.pid}.json`);
      try {
        fs.copyFileSync(CACHE, copy);                       // never touch the app's own file
        shown = new lib.LocalUsageScanner(copy).stats();    // stats() without refresh = what is on screen
        const recs = Object.values((readJSON(copy) || {}).files || {});
        cacheInfo = { written: fs.statSync(CACHE).mtimeMs, files: recs.length, pruned: recs.filter(x => x.pruned).length };
      } catch (e) { row('读 HUD 的缓存', '失败：' + e.message); }
      try { fs.unlinkSync(copy); } catch {}
    }
  }
  if (cacheInfo) {
    row('HUD 缓存最后写入', stamp(cacheInfo.written));
    row('缓存里记着的记录', cacheInfo.files + ' 个' + (cacheInfo.pruned ? `（${cacheInfo.pruned} 个已被 Claude Code 删掉，HUD 还留着）` : ''));
  } else if (lib) row('HUD 缓存', '没有（HUD 还没成功扫完过一次）');
  if (freshErr) row('用 HUD 的扫描器重扫', '失败：' + freshErr);
  if (fresh) {
    row('重扫结果 · 今天', fmtTok(fresh.today.tokens) + ' tokens');
    row('重扫结果 · lifetime', fmtTok(fresh.allTime.tokens) + ' tokens，从 ' + (fresh.allTime.firstDay || '—') + ' 起');
  }
  if (shown) {
    row('HUD 正在显示 · 今天', fmtTok(shown.today.tokens) + ' tokens');
    row('HUD 正在显示 · lifetime', fmtTok(shown.allTime.tokens) + ' tokens，从 ' + (shown.allTime.firstDay || '—') + ' 起');
  }

  head('[结论]');
  const v = [];
  const def = roots[0];
  const unreadable = roots.reduce((s, r) => s + (r.unreadable || 0), 0);
  if (unreadable) {
    // Ownership and permission bits are different faults with different cures;
    // chown alone leaves a mode-000 file just as unreadable as before.
    const foreign = roots.some(r => r.foreignOwners && r.foreignOwners.size);
    v.push(`• 有 ${unreadable} 个对话记录 HUD 读不了` +
      (foreign ? '（属主不是你，多半是某次用 sudo 跑过 claude）' : '（文件权限不允许读）') + '。' +
      '\n  HUD 3.2.0 碰到这种文件会放弃整轮扫描，数字就钉在最后一次成功的值；3.2.1 起会跳过它继续。' +
      '\n  根治：' + (foreign ? `sudo chown -R ${ME.username} ~/.claude && chmod -R u+rw ~/.claude/projects`
                              : 'chmod -R u+rw ~/.claude/projects'));
  }
  const elsewhere = roots.slice(1).filter(r => recentCalls(r) > recentCalls(def))
    .sort((a, b) => recentCalls(b) - recentCalls(a))[0];
  if (elsewhere) {
    v.push(`• Claude Code 最近的记录在「${elsewhere.label}」${tilde(elsewhere.dir)}，但 HUD 只读 ~/.claude/projects。` +
      '\n  这通常是设了 CLAUDE_CONFIG_DIR：终端里的 Claude Code 看得到它，从 Finder 打开的 HUD 看不到。');
  }
  const drift = active.find(r => r.asst > 0 && r.usable === 0);
  if (drift) v.push(`• 「${drift.label}」里有 assistant 记录却没有用量字段 —— Claude Code 可能改了记录格式，HUD 要跟着更新。`);
  if (fresh && shown && Math.abs(fresh.today.tokens - shown.today.tokens) > Math.max(1e6, fresh.today.tokens * 0.2)) {
    v.push('• HUD 正在显示的跟硬盘上的对不上 —— 可能卡住了。退出 HUD 重开，再跑一次这个诊断。');
  }
  if (!v.length && recentCalls(def) < 20) {
    v.push('• 这台 Mac 最近 7 天几乎没有 Claude Code 的调用。' +
      '\n  配额条算的是整个账号（claude.ai 网页、Claude App、手机、别的电脑都算），' +
      '\n  token 数只算「这台 Mac 上的 Claude Code」。平常主要在 claude.ai / Claude App 聊天的话，' +
      '\n  token 数本来就几乎不动 —— 这是范围不同，不是坏了。');
  }
  if (keepDays <= 30) {
    v.push(`• Claude Code 只保留 ${keepDays} 天的记录${keep == null ? '（默认值）' : ''}，更早的已经被它删了，lifetime 只能从那之后算起。` +
      '\n  HUD 3.2.1 起会把删除前读到的留住，不再跟着缩水；已经删掉的找不回来。');
  }
  if (!v.length) v.push('• 没发现问题：HUD 读到的跟这台 Mac 上 Claude Code 的记录一致。');
  console.log(v.join('\n'));
  console.log('\n—— 把上面整段贴回给发你这个包的人即可。');
})().catch(e => { console.log('\n诊断中途出错：' + ((e && e.stack) || e)); process.exit(1); });
JSEOF
HUD_APP="$APP" ELECTRON_RUN_AS_NODE=1 "$APP/Contents/MacOS/HUD for Claude" "$DIR/diagnose.js"
