# Chrome Web Store Listing — Claude HUD

Copy/paste these into the fields in the Chrome Web Store developer dashboard when you submit the extension for review.

---

## Extension name (max 75 chars)
```
Claude HUD — Floating Usage Meter
```

## Short summary (max 132 chars — appears in search results)
```
Shows your Claude.ai usage as a floating blood-bar HUD on your desktop. Never click into settings just to check your limits again.
```

## Category
```
Productivity
```

## Language
```
English (United States)
```

---

## Detailed description (long — goes in the main body of the listing)

```
Claude HUD is a tiny floating window that lives in the corner of your screen and shows your Claude.ai usage in real time — current session, weekly all-models, weekly Sonnet, and routine runs — as color-coded blood bars.

No more breaking your flow to click into claude.ai/settings/usage just to see how much you have left.

━━━━━━━━━━━━━━━━━━━━
HOW IT WORKS
━━━━━━━━━━━━━━━━━━━━

This Chrome extension is one half of a two-part system:

1. This extension quietly watches claude.ai/settings/usage and extracts the same numbers you'd see if you opened that page yourself.
2. It sends those numbers to the Claude HUD Mac app, which displays them as a floating bar graph.

Both halves are required — this extension does nothing useful on its own. You can download the Mac app at https://claudehud.app

━━━━━━━━━━━━━━━━━━━━
FEATURES
━━━━━━━━━━━━━━━━━━━━

• Auto-refreshes every 30 seconds — always up to date
• Color-coded bars: green under 50%, yellow 50–79%, red 80%+
• Tracks four metrics: current session, weekly all models, weekly Sonnet, daily routine runs
• Shows reset countdowns
• Zero configuration — install, open the Mac app, done

━━━━━━━━━━━━━━━━━━━━
PRIVACY
━━━━━━━━━━━━━━━━━━━━

Your data never leaves your computer.

• No analytics, no telemetry, no tracking
• No external servers — the extension talks only to the Claude HUD app on localhost (your own machine)
• No account, no login, no registration
• Reads only the usage numbers on claude.ai/settings/usage — does not read your conversations, prompts, or anything else

Full privacy policy: https://claudehud.app/privacy

━━━━━━━━━━━━━━━━━━━━
REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━

• Mac running macOS 11 Big Sur or later (Apple Silicon)
• Chrome (or any Chromium-based browser)
• A Claude.ai account you're signed into
• The free Claude HUD Mac app — download at https://claudehud.app

━━━━━━━━━━━━━━━━━━━━
TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━

Widget says "Waiting for data"?
→ Make sure you're signed into claude.ai in Chrome.
→ Make sure the Claude HUD Mac app is running.

Don't see a Chrome tab with claude.ai? The extension opens one automatically in the background. You'll see it in your tab list. Don't close it — that's how the data flows.

━━━━━━━━━━━━━━━━━━━━
FEEDBACK
━━━━━━━━━━━━━━━━━━━━

Questions, bugs, or ideas? Tweet at @YourHandle or email hello@claudehud.app

Claude HUD is not affiliated with Anthropic.
```

---

## Single-purpose description (required field — what is the ONE primary purpose of this extension?)

```
Claude HUD reads your Claude.ai usage percentages from claude.ai/settings/usage and sends them over localhost to a companion desktop app that displays them as a floating HUD. That's the only thing it does.
```

---

## Permission justifications (Google asks for each one separately)

### `storage` permission
```
We use chrome.storage.local to cache the most recently scraped usage numbers (e.g. "Session: 34%, Weekly: 12%") so the extension popup can display something immediately when clicked, without waiting for a fresh scrape. No personal data, no conversation content — only the four public usage percentages visible on claude.ai/settings/usage.
```

### `host_permissions` for `https://claude.ai/*`
```
We need access to claude.ai to read the usage numbers displayed on the /settings/usage page. The extension does not read, modify, or interact with any other part of Claude — no conversations, no prompts, no account data. It only extracts the four numeric percentages on the usage page and forwards them to the companion desktop app over localhost.
```

### Remote code use
```
No remote code is used. The extension contains only local scripts (content.js, background.js, popup.js). No scripts are fetched from external servers at runtime.
```

### Data usage disclosures (check these boxes in the CWS form)

- ☐ Personally identifiable information — NO
- ☐ Health information — NO
- ☐ Financial and payment information — NO
- ☐ Authentication information — NO
- ☐ Personal communications — NO
- ☐ Location — NO
- ☐ Web history — NO
- ☐ User activity — NO
- ☐ Website content — YES (we read the usage page content to extract the displayed percentages)

You will also need to certify:

- ☑ I do not sell or transfer user data to third parties outside of approved use cases
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Screenshots required (you need to take these on your Mac and upload)

Chrome Web Store requires at least one screenshot. Recommended size: **1280 × 800 pixels** (or 640 × 400 minimum). You can upload up to 5.

Suggested screenshots to take:
1. **Hero shot** — The HUD in the corner of your desktop with all four bars visible, against a nice desktop background. This is the image everyone will see in search results.
2. **Hover state** — HUD at 100% opacity with numbers clearly visible.
3. **Right-click menu** — Showing the "Launch at Login" / "Open claude.ai Usage Page" options.
4. **In context** — Your Claude chat open and the HUD floating in the corner, to show how it lives alongside your work.
5. **Color-coded bars** — A state where one bar is red (80%+), showing the warning visual.

How to take a screenshot on Mac at 1280×800:
→ `Cmd + Shift + 5` → select "Options" → set "Save to" → click "Capture Selected Portion" → draw a 1280×800 area, or screenshot the whole screen and resize later in Preview (Tools → Adjust Size → 1280 × 800).

---

## Promotional tile (optional but recommended)

**Small tile: 440 × 280 px** — shows up in search results and category pages. A clean graphic of the HUD on a dark background with the words "Claude HUD" works well.

You can skip this at first and add it later.

---

## Support email
```
hello@claudehud.app
```
(Or whatever email you want to use. Google requires a support email — can be a Gmail address, doesn't have to match your domain.)

## Developer website (optional)
```
https://claudehud.app
```

## Privacy policy URL (REQUIRED because we request host_permissions)
```
https://claudehud.app/privacy
```
You will need to host the privacy policy (draft is in `release-assets/privacy/privacy-policy.html`) at this URL before submitting. If you don't own claudehud.app yet, a GitHub Pages or Notion public page URL works fine.
