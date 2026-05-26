# HUD for Claude — Quick Start

A floating widget that shows your Claude.ai usage on your desktop, so you never have to click into settings just to see how much you've got left.

---

## What's in this zip

You'll have downloaded one of two zips:

**Mac zip (`HUD-for-Claude-Mac.zip`):**
```
├── HUD for Claude.dmg              ← the Mac app (Apple Silicon)
├── extension/                      ← Chrome extension — FALLBACK ONLY (use Web Store first, see step ②)
├── README.md                       ← you are here
└── TROUBLESHOOTING.md              ← if something goes wrong
```

**Windows zip (`HUD-for-Claude-Windows.zip`):**
```
├── HUD for Claude Setup 2.0.0.exe  ← the Windows installer (x64)
├── extension/                      ← Chrome extension — FALLBACK ONLY (use Web Store first, see step ②)
├── README.md                       ← you are here
└── TROUBLESHOOTING.md              ← if something goes wrong
```

---

## Install — 3 steps, about 2 minutes

### ① Install the desktop app

**On Mac (Apple Silicon):**

1. Double-click `HUD for Claude.dmg`
2. Drag **HUD for Claude** into your **Applications** folder
3. **Before you open it, run this one command in Terminal** (Cmd+Space → type "terminal" → Enter, then paste):

   ```bash
   xattr -cr "/Applications/HUD for Claude.app"
   ```

4. Now double-click **HUD for Claude** in Applications.

**Why the Terminal step?** macOS blocks unsigned apps downloaded from a browser by default. On newer macOS (Sonoma/Sequoia) you'll see a "HUD for Claude is damaged" dialog with no obvious way out; on older macOS you'll see "developer cannot be verified" and can right-click → Open instead. The `xattr -cr` command handles both cases up front — it just peels off the "downloaded from internet" marker macOS attaches to fresh downloads. You only need to do it once. The app itself is untouched.

(If you skipped step 3 and got the "damaged" or "developer cannot be verified" dialog — close it, run the command, then try opening the app again.)

**On Windows (x64):**

1. Double-click `HUD for Claude Setup 2.0.0.exe`
2. **Windows SmartScreen will pop up saying "Windows protected your PC"** — this is normal for apps not signed with a paid certificate. Click **More info** → **Run anyway**.
3. The installer wizard opens. Pick install location if you want (default works), keep "Desktop shortcut" and "Start Menu shortcut" checked, click **Install**.
4. After install, HUD for Claude launches automatically from the Start Menu / desktop shortcut.

Either way — you should now see a small floating window in the top-right corner of your screen saying "Waiting for data." That's the HUD. Keep it open.

### ② Install the Chrome extension

**Recommended path — install from the Chrome Web Store:**

→ Open this link in Chrome: **https://chromewebstore.google.com/detail/hud-for-claude/pbboagijhngmapjomijmohfhajapfajl**
→ Click **Add to Chrome** → **Add extension** → Done. Skip to step ③.

---

**Fallback path — only use this if the Web Store listing is unavailable** (e.g. the extension got delisted, you're offline, or your network blocks the Web Store):

The `extension/` folder in this zip is a local copy of the same extension. You can load it manually:

1. Open Chrome and go to this URL: `chrome://extensions`
2. In the top-right of that page, flip on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder from this zip
5. The extension should now show up with the HUD for Claude icon — done.

⚠️ The Web Store version is the one that gets updates automatically. If you load the local copy, you'll need to redownload the zip later to get the latest version.

### ③ Sign in to claude.ai

Make sure you're signed into https://claude.ai in Chrome. That's it.

Within 30 seconds, the "Waiting for data" message on the HUD will be replaced by your actual usage bars. 🎉

---

## Daily use

- The HUD stays in the corner of your screen always. It sits at 70% opacity when you're not looking at it, 100% when you hover over it.
- **Yellow dot** (top-right of the widget) = ghost mode, fades it to nearly invisible. Click again to bring it back.
- **Red dot** = quit the app.
- **Right-click anywhere on the widget** = menu with "Launch at Login", "Open claude.ai Usage Page", "Reload Widget", and "Quit".
- **Drag it** — grab any non-button part of the widget to move it around.
- **Resize it** — grab a corner.

By default, HUD for Claude launches automatically when you log into your computer (Mac and Windows both), so it's just always there. You can turn this off in the right-click menu.

---

## How it actually works (if you're curious)

The Chrome extension quietly keeps a tab open on your claude.ai usage page, refreshes it every 30 seconds, and reads the four usage percentages off that page. It pushes those numbers to the desktop app over localhost (port 27843 — your own computer, nothing touches the internet). The desktop app draws them as color-coded bars.

Your data never leaves your computer.

---

## Something not working?

See `TROUBLESHOOTING.md`.

---

## Feedback

This is a one-person side project. If something broke or you have ideas — tell me at metasui1491@gmail.com.

HUD for Claude is not affiliated with Anthropic.
