let ws = null;
let reconnectTimer = null;
let ensureInFlight = false;
const LIMITS_URL = 'https://claude.ai/new#settings/usage';
const REFRESH_ALARM = 'hud-refresh';

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

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'USAGE_DATA') {
    chrome.storage.local.set({ claudeUsage: message.payload });
    sendData(message.payload);
  }
});

// Ensure exactly one background tab sits on the usage page.
// Stateless by design: the current state is derived from chrome.tabs.query
// every call, so it survives MV3 service-worker restarts (which wipe every
// in-memory variable). The old code tracked the tab in a module global; when
// the worker restarted, that global reset to null and a new tab was spawned.
async function ensureLimitsTab() {
  if (ensureInFlight) return;
  ensureInFlight = true;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
    // Match both the old path route (/settings/usage) and the new hash-route
    // settings modal (#settings/usage) by not requiring a leading slash.
    // claude.ai moved settings into a #-hash modal, which broke the old
    // '/settings/usage' check and triggered the runaway tab spawning.
    const usageTabs = tabs.filter((t) => t.url && t.url.includes('settings/usage'));

    if (usageTabs.length > 0) {
      // Reuse the first match; close any extras (self-heals a runaway pile).
      for (let i = 1; i < usageTabs.length; i++) {
        chrome.tabs.remove(usageTabs[i].id).catch(() => {});
      }
      await chrome.tabs.reload(usageTabs[0].id);
    } else {
      await chrome.tabs.create({ url: LIMITS_URL, active: false });
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
