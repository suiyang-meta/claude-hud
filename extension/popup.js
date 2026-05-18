// popup.js
function getColor(pct) {
  if (pct >= 80) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

function renderBar(label, pct, resetInfo) {
  const color = getColor(pct);
  return `
    <div class="stat">
      <div class="stat-label">${label} <span>${pct}%</span></div>
      <div class="bar-bg"><div class="bar-fill ${color}" style="width:${pct}%"></div></div>
      ${resetInfo ? `<div class="reset-info">${resetInfo}</div>` : ''}
    </div>
  `;
}

chrome.storage.local.get(['claudeUsage'], (result) => {
  const data = result.claudeUsage;
  const content = document.getElementById('content');
  const ts = document.getElementById('ts');

  if (!data || !data.found) {
    content.innerHTML = '<div class="no-data">Open claude.ai usage page to load data</div>';
    return;
  }

  let html = '';
  if (data.session !== null) html += renderBar('Session', data.session, data.session_reset ? `Resets in ${data.session_reset}` : null);
  if (data.weekly_all !== null) html += renderBar('Weekly (All)', data.weekly_all, data.weekly_reset || null);
  if (data.weekly_sonnet !== null) html += renderBar('Weekly (Sonnet)', data.weekly_sonnet, null);
  if (data.daily_routines !== null) html += renderBar('Daily Routines', data.daily_routines.percent, `${data.daily_routines.used} / ${data.daily_routines.total} used`);

  content.innerHTML = html || '<div class="no-data">No usage data found</div>';

  if (data.timestamp) {
    const ago = Math.round((Date.now() - data.timestamp) / 1000);
    ts.textContent = `Updated ${ago}s ago`;
  }
});
