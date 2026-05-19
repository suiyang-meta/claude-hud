# HUD for Claude — Quick Start

A floating widget that shows your Claude.ai usage on your desktop, so you never have to click into settings just to see how much you've got left.

![What it looks like](screenshot-hero.png)

---

## What's in this zip

```
claude-hud/
├── HUD for Claude.dmg              ← the Mac app (Apple Silicon)
├── HUD for Claude Setup.exe        ← the Windows installer (x64)
├── extension/                      ← the Chrome extension (load this unpacked)
├── README.md                       ← you are here
└── TROUBLESHOOTING.md              ← if something goes wrong
```

You only need the installer for your platform — `.dmg` for Mac, `.exe` for Windows.

---

## Install — 3 steps, about 2 minutes

### ① Install the desktop app

**On Mac (Apple Silicon):**

1. Double-click `HUD for Claude.dmg`
2. Drag **HUD for Claude** into your **Applications** folder
3. Open your Applications folder and double-click **HUD for Claude**

**First time you open it, macOS will say "HUD for Claude cannot be opened because the developer cannot be verified."** This is normal for apps not distributed through the Mac App Store. To open it anyway:

→ Right-click (or Control-click) the HUD for Claude app → click **Open** → in the dialog, click **Open** again.

(You only need to do this the first time.)

**On Windows (x64):**

1. Double-click `HUD for Claude Setup 1.2.0.exe`
2. **Windows SmartScreen will pop up saying "Windows protected your PC"** — this is normal for apps not signed with a paid certificate. Click **More info** → **Run anyway**.
3. The installer wizard opens. Pick install location if you want (default works), keep "Desktop shortcut" and "Start Menu shortcut" checked, click **Install**.
4. After install, HUD for Claude launches automatically from the Start Menu / desktop shortcut.

Either way — you should now see a small floating window in the top-right corner of your screen saying "Waiting for data." That's the HUD. Keep it open.

### ② Install the Chrome extension

> **Easy path** — install from the Chrome Web Store: https://chromewebstore.google.com/detail/hud-for-claude/pbboagijhngmapjomijmohfhajapfajl and skip to step ③.
>
> **Manual path** (if you prefer to load unpacked):

1. Open Chrome and go to this URL: `chrome://extensions`
2. In the top-right of that page, flip on **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/` folder from this zip
5. The extension should now show up with the HUD for Claude icon — done.

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

The Chrome extension quietly keeps a tab open at claude.ai/settings/usage, refreshes it every 30 seconds, and reads the four usage percentages off that page. It pushes those numbers to the desktop app over localhost (port 27843 — your own computer, nothing touches the internet). The desktop app draws them as color-coded bars.

Your data never leaves your computer.

---

## Something not working?

See `TROUBLESHOOTING.md`.

---

## Feedback

This is a one-person side project. If something broke or you have ideas — tell me:
- Email: hello@claudehud.app
- Twitter/X: (TBD)

HUD for Claude is not affiliated with Anthropic.
