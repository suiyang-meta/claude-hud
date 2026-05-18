let ws = null;
let reconnectTimer = null;
let limitsTabId = null;
const LIMITS_URL = 'https://claude.ai/settings/usage';
const REFRESH_INTERVAL = 30000;

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
    const data = message.payload;
    chrome.storage.local.set({ claudeUsage: data });
    sendData(data);
  }
});

async function ensureLimitsTab() {
  // Search by URL pattern to catch redirects/query strings
  const allClaudeTabs = await chrome.tabs.query({ url: 'https://claude.ai/*' });
  const existingTab = allClaudeTabs.find(t => t.url && t.url.includes('/settings/usage'));

  if (existingTab) {
    // Reuse existing tab
    limitsTabId = existingTab.id;
    await chrome.tabs.reload(limitsTabId);
  } else if (!limitsTabId) {
    // Only open new tab if we don't have one tracked
    const tab = await chrome.tabs.create({ url: LIMITS_URL, active: false });
    limitsTabId = tab.id;
  }
}

// If user manually closes our tab, reset tracker
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === limitsTabId) {
    limitsTabId = null;
  }
});

function startAutoRefresh() {
  setInterval(async () => {
    try {
      await ensureLimitsTab();
    } catch (e) {
      limitsTabId = null;
    }
  }, REFRESH_INTERVAL);
}

connect();
ensureLimitsTab().then(startAutoRefresh).catch(() => startAutoRefresh());
