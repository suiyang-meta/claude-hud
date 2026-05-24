// content.js — runs on every claude.ai page.
//
// Two modes:
//   - Passive (default): just scrape usage data from the current page when
//     it's visible. This is what runs on tabs the user opened themselves.
//   - Active (HUD-managed): the background opened this tab with a `?hud=1`
//     query marker. If the current page doesn't already show usage data,
//     this script will try to find a "Usage" nav link and click it, so we
//     keep finding the usage screen even when Claude.ai changes the URL.

const HUD_PARAM = 'hud';
const params = new URLSearchParams(window.location.search);
const isHudManaged = params.get(HUD_PARAM) === '1';

function scrapeUsageData() {
  const data = {
    timestamp: Date.now(),
    session: null,
    weekly_all: null,
    weekly_sonnet: null,
    daily_routines: null,
    found: false
  };

  try {
    const allText = document.body.innerText;

    const sessionMatch = allText.match(/Current session[\s\S]*?(\d+)%\s*used/);
    if (sessionMatch) {
      data.session = parseInt(sessionMatch[1]);
      data.found = true;
    }

    const weeklyAllMatch = allText.match(/All models[\s\S]*?(\d+)%\s*used/);
    if (weeklyAllMatch) {
      data.weekly_all = parseInt(weeklyAllMatch[1]);
      data.found = true;
    }

    const sonnetMatch = allText.match(/Sonnet only[\s\S]*?(\d+)%\s*used/);
    if (sonnetMatch) {
      data.weekly_sonnet = parseInt(sonnetMatch[1]);
      data.found = true;
    }

    const routinesMatch = allText.match(/Daily included routine runs[\s\S]*?(\d+)\s*\/\s*(\d+)/);
    if (routinesMatch) {
      data.daily_routines = {
        used: parseInt(routinesMatch[1]),
        total: parseInt(routinesMatch[2]),
        percent: Math.round((parseInt(routinesMatch[1]) / parseInt(routinesMatch[2])) * 100)
      };
      data.found = true;
    }

    const sessionResetMatch = allText.match(/Resets in ([\d\w\s]+)/);
    if (sessionResetMatch) {
      data.session_reset = sessionResetMatch[1].trim();
    }

    const weeklyResetMatch = allText.match(/Resets ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]+)/);
    if (weeklyResetMatch) {
      data.weekly_reset = weeklyResetMatch[1].trim();
    }

    const spentMatch = allText.match(/\$([\d.]+)\s+spent/);
    const limitMatch = allText.match(/\$([\d]+)\s*\n?\s*Monthly spend limit/);
    const balanceMatch = allText.match(/\$([\d.]+)\s*\n?\s*Current balance/);
    const extraResetMatch = allText.match(/Resets ((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^\n]+)/);
    if (spentMatch && limitMatch) {
      const spent = parseFloat(spentMatch[1]);
      const limit = parseInt(limitMatch[1]);
      data.extra_usage = {
        spent,
        limit,
        balance: balanceMatch ? parseFloat(balanceMatch[1]) : null,
        reset: extraResetMatch ? extraResetMatch[1].trim() : null,
        percent: Math.round((spent / limit) * 100)
      };
    }
  } catch (e) {
    console.log('[HUD for Claude] Parse error:', e);
  }

  return data;
}

function trySendData() {
  const data = scrapeUsageData();
  if (data.found) {
    chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data });
  }
  return data.found;
}

// Walks the live DOM for a visible "Usage" nav element (link or button)
// and returns it, or null if none. Used in active mode when the current
// page doesn't already show usage numbers — lets us follow Claude.ai's
// settings sidebar instead of hard-coding the URL.
function findUsageNavLink() {
  const candidates = document.querySelectorAll('a, button, [role="link"], [role="tab"], [role="menuitem"]');
  for (const el of candidates) {
    const text = (el.innerText || el.textContent || '').trim();
    if (text === 'Usage' || text === 'usage') {
      // Filter to visible elements — offsetParent is null for display:none /
      // detached nodes. Avoids triggering hidden modal items.
      if (el.offsetParent !== null) return el;
    }
  }
  return null;
}

// Active mode: opened by HUD via background. Try to scrape; if there's no
// usage data on screen, walk the DOM for a "Usage" nav link and click it.
// Falls back to reporting SCRAPE_FAILED if neither path produces data —
// background uses that signal to clear its cached URL and re-discover.
async function scrapeOrNavigate() {
  // First wait for the SPA's initial render to settle.
  await new Promise((r) => setTimeout(r, 1500));

  if (trySendData()) return;

  const usageLink = findUsageNavLink();
  if (!usageLink) {
    chrome.runtime.sendMessage({ type: 'SCRAPE_FAILED' });
    return;
  }

  usageLink.click();
  // Click triggers SPA navigation. The MutationObserver below will fire
  // trySendData() as the DOM updates. Give it a generous window, then
  // report failure if nothing came through.
  await new Promise((r) => setTimeout(r, 5000));
  if (!trySendData()) {
    chrome.runtime.sendMessage({ type: 'SCRAPE_FAILED' });
  }
}

// MutationObserver re-scrapes whenever the page updates (covers both the
// initial SPA hydration and any DOM updates after a Usage-link click).
const observer = new MutationObserver(() => {
  trySendData();
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// First pass on script load.
trySendData();

// Active-mode discovery — only on HUD-managed tabs (?hud=1). User-opened
// claude.ai tabs stay in passive mode: they scrape if usage data is on
// screen but never click anything or report failures.
if (isHudManaged) {
  scrapeOrNavigate();
}

// Re-scrape every 30s as a fallback (the page can update without a DOM
// mutation that hits the observer, e.g. when only text content changes).
setInterval(trySendData, 30000);
