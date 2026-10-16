/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
/**
 * Activity card — runs in the Claude panel (index.html), not in main.
 *
 * The Claude desktop app's Code tab opened on this card until its 2026-10-15
 * update dropped it: six figures, a 26-week heatmap of messages per day and a
 * per-model token chart, each over All / 30d / 7d. Rebuilt here from that
 * version's own layout and arithmetic (its Ku / qu / Zu / ad components), in
 * the panel's palette instead of the desktop app's blue. One deliberate change
 * (picked on 2026-10-16 from three versions side by side): the
 * heatmap's four shades split the active days into quartiles instead of four
 * equal slices of the busiest day, which left nearly every day in the bottom
 * two shades once a few very heavy days set the top.
 *
 * Data is LocalUsageScanner.activity(): daily rows, summed here per range.
 */
(function () {
  'use strict';

  const WEEKS = 26;                       // the heatmap always shows the last 182 days
  const RANGES = { all: null, '30d': 30, '7d': 7 };
  const MODEL_ROWS = 6;                   // legend rows before "Show N more"
  const MIN_SHARE = 0.0005;               // models under 0.05% of the range are dropped, as before
  const BOOKS = [                         // the original's comparison table, unchanged
    { name: 'The Little Prince', tokens: 22e3 },
    { name: 'Animal Farm', tokens: 39e3 },
    { name: 'The Great Gatsby', tokens: 62e3 },
    { name: "Harry Potter and the Philosopher's Stone", tokens: 103e3 },
    { name: 'The Hobbit', tokens: 123e3 },
    { name: 'Pride and Prejudice', tokens: 156e3 },
    { name: 'Dune', tokens: 244e3 },
    { name: 'Moby-Dick', tokens: 268e3 },
    { name: 'The Lord of the Rings', tokens: 576e3 },
    { name: 'War and Peace', tokens: 73e4 },
  ];

  const CSS = `
  .ac { position:relative; display:flex; flex-direction:column; gap:10px; }
  .ac-bar { display:flex; align-items:center; gap:6px; }
  .ac-bar .sp { flex:1; }
  .ac-seg { display:flex; }
  .ac-seg button { all:unset; cursor:pointer; font-size:9.5px; line-height:1; padding:4px 6px;
    border-radius:4px; color:var(--text-low); transition:color .15s, background-color .15s; }
  .ac-seg button:hover { color:var(--text-mid); }
  .ac-seg button.on { color:var(--text); background:rgba(242,236,231,0.07); }
  .ac-tiles { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:4px; }
  .ac-tile { display:flex; flex-direction:column; gap:3px; padding:6px 7px 7px; border-radius:6px;
    background:rgba(242,236,231,0.045); min-width:0; }
  .ac-tile .l { font-size:8.5px; color:var(--text-low); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ac-tile .v { font-size:13px; font-weight:600; color:var(--text); letter-spacing:-.2px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ac-tile .v.small { font-size:10.5px; font-weight:500; letter-spacing:0; padding-top:2px; }
  .ac-heat { display:grid; grid-template-columns:repeat(${WEEKS}, minmax(0, 1fr));
    grid-template-rows:repeat(7, auto); grid-auto-flow:column; gap:2px; }
  .ac-heat i { display:block; aspect-ratio:1; border-radius:2px; background:var(--track); }
  .ac-heat i.f { background:transparent; }
  .ac-heat i.l1 { background:hsl(16 46% 22%); }
  .ac-heat i.l2 { background:hsl(16 56% 34%); }
  .ac-heat i.l3 { background:hsl(16 64% 48%); }
  .ac-heat i.l4 { background:hsl(20 90% 66%); }
  .ac-heat i.t { box-shadow:0 0 0 1px rgba(242,236,231,0.45); }
  .ac-heat i:hover { box-shadow:0 0 0 1px rgba(242,236,231,0.8); }
  .ac-note { font-size:8.5px; color:var(--text-low); line-height:1.4; }
  .ac-tip { position:absolute; z-index:5; pointer-events:none; padding:4px 7px; border-radius:5px;
    background:rgba(28,22,20,0.96); box-shadow:0 0 0 1px rgba(242,236,231,0.10), 0 4px 14px rgba(0,0,0,0.5);
    font-size:9.5px; color:var(--text); white-space:nowrap; opacity:0; transition:opacity .08s; }
  .ac-tip.on { opacity:1; }
  .ac-tip .ac-tr { display:flex; align-items:center; gap:5px; color:var(--text-mid); margin-top:2px; }
  .ac-tip .ac-tr b { font-weight:500; color:var(--text); }
  .ac-tip .ac-dot { width:6px; height:6px; border-radius:50%; flex:none; }
  .ac-chart { display:grid; grid-template-columns:auto minmax(0, 1fr); grid-template-rows:118px auto;
    gap:6px 7px; font-size:8px; color:var(--text-low); }
  .ac-y { display:flex; flex-direction:column-reverse; justify-content:space-between; align-items:flex-end; }
  .ac-y span { height:0; display:flex; align-items:center; white-space:nowrap; }
  .ac-cols { display:flex; min-width:0; border-bottom:1px solid var(--hair); }
  .ac-col { flex:1; min-width:0; display:flex; flex-direction:column-reverse; align-items:center; }
  .ac-col i { display:block; width:72%; flex:none; }
  .ac-col i:last-child { border-radius:2px 2px 0 0; }
  .ac-col:hover i { filter:brightness(1.25); }
  .ac-x { grid-column:2; display:flex; min-width:0; }
  .ac-x span { flex:1; min-width:0; display:flex; justify-content:center; white-space:nowrap; }
  .ac-legend { display:flex; flex-direction:column; gap:5px; }
  .ac-lg { display:flex; align-items:center; gap:6px; font-size:9.5px; min-width:0; }
  .ac-lg .sw { width:7px; height:7px; border-radius:2px; flex:none; }
  .ac-lg .n { flex:1; min-width:0; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .ac-lg .io { color:var(--text-low); white-space:nowrap; font-size:8.5px; }
  .ac-lg .p { color:var(--text); width:38px; text-align:right; flex:none; }
  .ac-more { all:unset; cursor:pointer; align-self:flex-start; font-size:8.5px; color:var(--text-low); }
  .ac-more:hover { color:var(--text-mid); }
  .ac-empty { font-size:9.5px; color:var(--text-low); padding:16px 0; text-align:center; }
  `;

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const int = (n) => Number(n || 0).toLocaleString('en-US');
  const fmtTokens = (n) =>
    n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' :
    n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(Math.round(n || 0));
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const shortDay = (key) => { const p = key.split('-'); return MONTHS[+p[1] - 1] + ' ' + +p[2]; };
  const hourText = (h) => (h == null ? '—' : `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`);
  function prettyModel(id) {
    const s = String(id || 'unknown').replace(/^claude-/, '').replace(/-\d{8}$/, '').split('-');
    const fam = s.shift() || '', ver = s.join('.');
    return fam.charAt(0).toUpperCase() + fam.slice(1) + (ver ? ' ' + ver : '');
  }
  // Model colours, largest first: the accent, then deeper steps of the same hue.
  const modelColor = (i) => `hsl(16 62% ${Math.max(24, 62 - i * 7)}%)`;

  // Local calendar dates only: these are the user's days, not UTC's.
  const keyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dateOf = (key) => { const p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); };
  function shiftKey(key, days) { const d = dateOf(key); d.setDate(d.getDate() + days); return keyOf(d); }

  /** The range's figures — the desktop app's Mu(), on daily rows. */
  function ranged(act, range, today) {
    const n = RANGES[range];
    const from = n ? shiftKey(today, -(n - 1)) : null;
    const inRange = (d) => (!from || d >= from) && d <= today;
    let sessions = 0, messages = 0, activeDays = 0;
    for (const d of act.days) {
      if (!inRange(d.date)) continue;
      sessions += d.sessions; messages += d.messages; activeDays++;
    }
    const byModel = {};
    const chartDays = [];
    for (const date of Object.keys(act.tokens).sort()) {
      if (!inRange(date)) continue;
      const day = act.tokens[date];
      chartDays.push({ date, day });
      for (const [m, v] of Object.entries(day)) {
        const r = byModel[m] || (byModel[m] = { model: m, tokens: 0, input: 0, output: 0 });
        r.tokens += v[0]; r.input += v[1]; r.output += v[2];
      }
    }
    const all = Object.values(byModel).sort((a, b) => b.tokens - a.tokens);
    const totalTokens = all.reduce((s, r) => s + r.tokens, 0);
    const models = all.filter((r) => r.tokens >= totalTokens * MIN_SHARE);
    return { sessions, messages, activeDays, totalTokens, models, chartDays };
  }

  /**
   * 26 columns of weeks, Sunday on top, ending with the current week. Each
   * active day gets a shade 1–4 by quartile of the active days on show
   * (nearest rank). When they are all alike there is no spread to split, and
   * they all take the top shade.
   */
  function heatWeeks(act, today) {
    const counts = new Map(act.days.map((d) => [d.date, d.messages]));
    const t = dateOf(today);
    const end = new Date(t); end.setDate(t.getDate() + (6 - t.getDay()));
    const start = new Date(end); start.setDate(end.getDate() - WEEKS * 7 + 1);
    const cells = [];
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const date = keyOf(d);
      cells.push({ date, count: counts.get(date) || 0, future: date > today });
    }
    const v = cells.filter((c) => !c.future && c.count > 0).map((c) => c.count).sort((a, b) => a - b);
    const q = (p) => v[Math.floor(p * (v.length - 1))];
    const [p25, p50, p75] = v.length ? [q(0.25), q(0.5), q(0.75)] : [0, 0, 0];
    const flat = v.length && v[0] === v[v.length - 1];
    for (const c of cells) {
      c.level = c.future || !c.count ? 0
        : flat ? 4 : 1 + (c.count > p25) + (c.count > p50) + (c.count > p75);
    }
    return cells;
  }

  /** Round axis ticks: at most 6 steps of 1/2/5×10ⁿ, about 4 preferred. */
  function ticks(max) {
    if (max <= 0) return [];
    const mag = 10 ** Math.floor(Math.log10(max / 6));
    const best = [1, 2, 5, 10, 20, 50]
      .map((k) => { const step = Math.max(1, k * mag); return { step, steps: Math.ceil(max / step) }; })
      .filter((c) => c.steps <= 6)
      .reduce((a, c) => {
        const ca = c.step * c.steps, aa = a.step * a.steps;
        return ca < aa || (ca === aa && Math.abs(c.steps - 4) < Math.abs(a.steps - 4)) ? c : a;
      });
    return Array.from({ length: best.steps + 1 }, (_, i) => i * best.step);
  }

  function mount(root, opts = {}) {
    if (!document.getElementById('ac-style')) {
      const st = document.createElement('style'); st.id = 'ac-style'; st.textContent = CSS;
      document.head.appendChild(st);
    }
    const saved = (k, dflt, ok) => { try { const v = localStorage.getItem(k); return ok(v) ? v : dflt; } catch { return dflt; } };
    const keep = (k, v) => { try { localStorage.setItem(k, v); } catch { /* per-viewer nicety only */ } };
    let tab = saved('ac.tab', 'overview', (v) => v === 'overview' || v === 'models');
    let range = saved('ac.range', 'all', (v) => v in RANGES);
    let moreModels = false;
    const bookPick = Math.random();       // fixed per panel load, like the original
    let act = null, today = null, tipFor = null;

    function render() {
      if (!act) {
        root.innerHTML = `<div class="ac-empty">Reading Claude Code history…</div>`;
        return opts.onLayout && opts.onLayout();
      }
      if (!act.days.length && !Object.keys(act.tokens).length) {
        root.innerHTML = `<div class="ac-empty">No Claude Code activity yet</div>`;
        return opts.onLayout && opts.onLayout();
      }
      const r = ranged(act, range, today);
      const seg = (name, cur, items) => `<div class="ac-seg" data-seg="${name}">${items.map(([v, label]) =>
        `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${label}</button>`).join('')}</div>`;
      const bar = `<div class="ac-bar">${seg('tab', tab, [['overview', 'Overview'], ['models', 'Models']])}
        <span class="sp"></span>${seg('range', range, [['all', 'All'], ['30d', '30d'], ['7d', '7d']])}</div>`;
      root.innerHTML = `<div class="ac">${bar}${tab === 'overview' ? overview(r) : models(r)}<div class="ac-tip"></div></div>`;
      opts.onLayout && opts.onLayout();
    }

    function overview(r) {
      const tile = (label, value, small) =>
        `<div class="ac-tile"><span class="l">${label}</span><span class="v ${small ? 'small' : 'num'}">${esc(value)}</span></div>`;
      const top = r.models[0];
      const tiles = `<div class="ac-tiles">
        ${tile('Sessions', int(r.sessions))}${tile('Messages', int(r.messages))}${tile('Total tokens', fmtTokens(r.totalTokens))}
        ${tile('Active days', String(r.activeDays))}${tile('Peak hour', hourText(act.peakHour))}
        ${tile('Favorite model', top ? prettyModel(top.model) : '—', true)}</div>`;
      const heat = `<div class="ac-heat" role="img" aria-label="Daily activity heatmap">${heatWeeks(act, today).map((c) =>
        c.future ? '<i class="f"></i>'
          : `<i class="${c.level ? 'l' + c.level : ''}${c.date === today ? ' t' : ''}" data-d="${c.date}" data-n="${c.count}"></i>`).join('')}</div>`;
      return tiles + heat + book(r.totalTokens);
    }

    function book(total) {
      const fits = BOOKS.filter((b) => total >= b.tokens);
      if (!fits.length) return '';
      const b = fits[Math.floor(bookPick * fits.length)];
      const times = Math.floor(total / b.tokens);
      return `<div class="ac-note">${times >= 2
        ? `You’ve used ~${int(times)}× more tokens than ${esc(b.name)}.`
        : `You’ve used about as many tokens as ${esc(b.name)}.`}</div>`;
    }

    function models(r) {
      if (!r.models.length) return `<div class="ac-empty">No model usage in this range</div>`;
      const keys = r.models.map((m) => m.model);
      let peak = 0;
      const days = r.chartDays.map(({ date, day }) => {
        let sum = 0;
        const segs = [];
        keys.forEach((m, i) => { const v = day[m] ? day[m][0] : 0; if (v > 0) { segs.push({ m, v, i }); sum += v; } });
        peak = Math.max(peak, sum);
        return { date, segs };
      });
      const tk = ticks(peak), top = tk[tk.length - 1] || 1;
      const width = root.clientWidth || 240;
      const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((width - 30) / 40))));
      const chart = `<div class="ac-chart" role="img" aria-label="Daily tokens by model">
        <div class="ac-y">${tk.map((t) => `<span>${fmtTokens(t)}</span>`).join('')}</div>
        <div class="ac-cols">${days.map((d) => `<div class="ac-col" data-day="${d.date}">${d.segs.map((s) =>
          `<i style="height:${(s.v / top) * 100}%;background:${modelColor(s.i)}"></i>`).join('')}</div>`).join('')}</div>
        <div class="ac-x">${days.map((d, i) => `<span>${i % every === 0 ? shortDay(d.date) : ''}</span>`).join('')}</div>
      </div>`;
      const shown = moreModels ? r.models : r.models.slice(0, MODEL_ROWS);
      const rest = r.models.length - shown.length;
      const legend = `<div class="ac-legend">${shown.map((m, i) => `<div class="ac-lg">
          <span class="sw" style="background:${modelColor(i)}"></span>
          <span class="n">${esc(prettyModel(m.model))}</span>
          <span class="io num">${fmtTokens(m.input)} in · ${fmtTokens(m.output)} out</span>
          <span class="p num">${((m.tokens / (r.totalTokens || 1)) * 100).toFixed(1)}%</span></div>`).join('')}
        ${r.models.length > MODEL_ROWS ? `<button class="ac-more">${moreModels ? 'Show less' : `Show ${rest} more`}</button>` : ''}</div>`;
      tipFor = { keys, chartDays: r.chartDays };
      return chart + legend;
    }

    root.addEventListener('click', (e) => {
      const b = e.target.closest('.ac-seg button');
      if (b) {
        const which = b.parentElement.dataset.seg, v = b.dataset.v;
        if (which === 'tab') { tab = v; keep('ac.tab', v); } else { range = v; keep('ac.range', v); }
        return render();
      }
      if (e.target.closest('.ac-more')) { moreModels = !moreModels; render(); }
    });

    root.addEventListener('mouseover', (e) => {
      const tip = root.querySelector('.ac-tip');
      if (!tip) return;
      const cell = e.target.closest('.ac-heat i[data-d]');
      const col = !cell && e.target.closest('.ac-col');
      let html = null, anchor = cell || col;
      if (cell) {
        html = `${shortDay(cell.dataset.d)} — ${int(cell.dataset.n)}`;
      } else if (col && tipFor) {
        const day = (tipFor.chartDays.find((d) => d.date === col.dataset.day) || {}).day || {};
        html = `<b>${shortDay(col.dataset.day)}</b>` + tipFor.keys.map((m, i) => day[m] && day[m][0] > 0
          ? `<div class="ac-tr"><span class="ac-dot" style="background:${modelColor(i)}"></span>${esc(prettyModel(m))}: <b class="num">${fmtTokens(day[m][0])}</b></div>` : '').join('');
      }
      if (!html) { tip.classList.remove('on'); return; }
      tip.innerHTML = html;
      const box = root.querySelector('.ac').getBoundingClientRect(), a = anchor.getBoundingClientRect();
      tip.classList.add('on');
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const x = Math.min(Math.max(0, a.left - box.left + a.width / 2 - w / 2), box.width - w);
      const above = a.top - box.top - h - 6;
      tip.style.left = x + 'px';
      tip.style.top = (above >= 0 ? above : a.bottom - box.top + 6) + 'px';
    });
    root.addEventListener('mouseleave', () => { const tip = root.querySelector('.ac-tip'); if (tip) tip.classList.remove('on'); });

    return {
      update(next, todayKey) {
        act = next || null;
        today = todayKey || keyOf(new Date());
        render();
      },
      render,
    };
  }

  window.ActivityCard = { mount };
})();
