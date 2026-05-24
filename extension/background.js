let ws = null;
let reconnectTimer = null;
let ensureInFlight = false;
const FALLBACK_URL = 'https://claude.ai/settings/usage';
const REFRESH_ALARM = 'hud-refresh';
const CACHED_URL_KEY = 'hudCachedUsageUrl';
const SCRAPE_FAIL_KEY = 'hudScrapeFailCount';
const MAX_FAIL_BEFORE_CACHE_RESET = 3;

function connect() {
  try {
    ws = new WebSocket('ws://localhost:27843');
    ws.onopen = () => {
      clearTimeout(reconnectTimer);
      chrome.storage.local.get(['claudeUsage'], (result) => {
        if (result.claudeUsage) sendData(result.claudeUsage);
      });
    };
    ws.onclose = () => { reconnectTimer = setTimeout(connect, 3000); };
    ws.onerror = () => { ws = null; };
  } catch (e) {
    reconnectTimer = setTimeout(connect, 3000);
  }
}

function sendData(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'USAGE_DATA') {
    chrome.storage.local.set({ claudeUsage: message.payload, [SCRAPE_FAIL_KEY]: 0 });
    sendData(message.payload);

    // Cache the URL that actually worked, stripped of our ?hud=1 marker,
    // so the next refresh can fast-path straight to it without re-running
    // the Usage-link discovery dance.
    if (sender && sender.tab && sender.tab.url) {
      try {
        const u = new URL(sender.tab.url);
        u.searchParams.delete('hud');
        chrome.storage.local.set({ [CACHED_URL_KEY]: u.toString() });
      } catch (e) { /* ignore malformed URL */ }
    }
  } else if (message.type === 'SCRAPE_FAILED') {
    // The HUD-managed tab couldn't find usage data even after trying to
    // click the "Usage" nav link. Bump the failure counter; if it crosses
    // the threshold, clear the cached URL so the next refresh falls back
    // to FALLBACK_URL and re-discovers fresh.
    chrome.storage.local.get([SCRAPE_FAIL_KEY], (result) => {
      const count = (result[SCRAPE_FAIL_KEY] || 0) + 1;
      chrome.storage.local.set({ [SCRAPE_FAIL_KEY]: count });
      if (count >= MAX_FAIL_BEFORE_CACHE_RESET) {
        chrome.storage.local.remove(CACHED_URL_KEY);
      }
    });
  }
});

// Returns the URL to open for a fresh HUD-managed tab.
// Tags it with ?hud=1 so the content script can tell its own tab apart
// from a user-opened claude.ai tab (and only the HUD-tagged one will
// auto-click "Usage" or get cleaned up as a duplicate).
async function getStartUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CACHED_URL_KEY], (result) => {
      const base = result[CACHED_URL_KEY] || FALLBACK_URL;
      try {
        const u = new URL(base);
        u.searchParams.set('hud', '1');
        resolve(u.toString());
      } catch (e) {
        resolve(FALLBACK_URL + '?hud=1');
      }
    });
  });
}

// Ensure exactly one HUD-managed background tab sits on the usage page.
// Stateless by design: the current state is derived from chrome.tabs.query
// every call, so it survives MV3 service-worker restarts (which wipe every
// in-memory variable). The HUD-tagged URL marker (?hud=1) keeps us from
// touching tabs the user opened themselves.
async function ensureLimitsTab() {
  if (ensureInFlight) return;
  ensureInFlight = true;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    const usageTabs = tabs.filter((t) => t.url && t.url.includes('settings/usage'));
    const hudTagged = usageTabs.filter((t) => t.url.includes('hud=1'));

    if (hudTagged.length > 0) {
      // Reuse our own tab; close any HUD-tagged duplicates only.
      // Never close a usage tab the user opened themselves.
      for (let i = 1; i < hudTagged.length; i++) {
        chrome.tabs.remove(hudTagged[i].id).catch(() => {});
      }
      await chrome.tabs.reload(hudTagged[0].id);
    } else if (usageTabs.length > 0) {
      // There's a user-opened usage tab — passively reload it. The content
      // script will scrape but won't try to navigate (no ?hud=1 marker).
      // We don't spawn a duplicate HUD tab on top of the user's.
      await chrome.tabs.reload(usageTabs[0].id);
    } else {
      const startUrl = await getStartUrl();
      await chrome.tabs.create({ url: startUrl, active: false });
    }
  } finally {
    ensureInFlight = false;
  }
}

// MV3-safe periodic refresh. setInterval dies when Chrome suspends the
// service worker; chrome.alarms persists and wakes the worker on schedule.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    ensureLimitsTab().catch(() => {});
  }
});

function scheduleRefresh() {
  // Don't recreate an existing alarm — recreating resets its countdown, and
  // the worker can wake more often than every 30s (each content-script
  // message wakes it), which would keep pushing the alarm out of reach.
  chrome.alarms.get(REFRESH_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 0.5 });
    }
  });
}

connect();
scheduleRefresh();
ensureLimitsTab().catch(() => {});
