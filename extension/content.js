// content.js - runs on claude.ai pages
// Scrapes usage data and sends to background

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
    // Find all progress bars / usage elements
    // Claude's usage page uses specific text patterns
    const allText = document.body.innerText;

    // Parse session usage
    const sessionMatch = allText.match(/Current session[\s\S]*?(\d+)%\s*used/);
    if (sessionMatch) {
      data.session = parseInt(sessionMatch[1]);
      data.found = true;
    }

    // Parse weekly all models
    const weeklyAllMatch = allText.match(/All models[\s\S]*?(\d+)%\s*used/);
    if (weeklyAllMatch) {
      data.weekly_all = parseInt(weeklyAllMatch[1]);
      data.found = true;
    }

    // Parse weekly sonnet
    const sonnetMatch = allText.match(/Sonnet only[\s\S]*?(\d+)%\s*used/);
    if (sonnetMatch) {
      data.weekly_sonnet = parseInt(sonnetMatch[1]);
      data.found = true;
    }

    // Parse daily routines (format: "X / 15")
    const routinesMatch = allText.match(/Daily included routine runs[\s\S]*?(\d+)\s*\/\s*(\d+)/);
    if (routinesMatch) {
      data.daily_routines = {
        used: parseInt(routinesMatch[1]),
        total: parseInt(routinesMatch[2]),
        percent: Math.round((parseInt(routinesMatch[1]) / parseInt(routinesMatch[2])) * 100)
      };
      data.found = true;
    }

    // Also try to get reset times
    const sessionResetMatch = allText.match(/Resets in ([\d\w\s]+)/);
    if (sessionResetMatch) {
      data.session_reset = sessionResetMatch[1].trim();
    }

    const weeklyResetMatch = allText.match(/Resets ((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^\n]+)/);
    if (weeklyResetMatch) {
      data.weekly_reset = weeklyResetMatch[1].trim();
    }

  } catch (e) {
    console.log('[HUD for Claude] Parse error:', e);
  }

  return data;
}

function sendData() {
  const data = scrapeUsageData();
  if (data.found) {
    chrome.runtime.sendMessage({ type: 'USAGE_DATA', payload: data });
    console.log('[HUD for Claude] Sent usage data:', data);
  }
}

// Run immediately
sendData();

// Also observe DOM changes (page updates without reload)
const observer = new MutationObserver(() => {
  sendData();
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true
});

// Re-scrape every 30 seconds as fallback
setInterval(sendData, 30000);
