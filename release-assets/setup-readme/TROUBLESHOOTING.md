# Troubleshooting — HUD for Claude

## The widget says "Waiting for data" and never updates

This almost always means one of three things:

1. **You're not signed into claude.ai in Chrome.**
   Open Chrome, go to https://claude.ai, sign in. Wait 30 seconds.

2. **The Chrome extension isn't installed or isn't enabled.**
   Go to `chrome://extensions` — is "HUD for Claude" in the list? Is the toggle flipped on?

3. **Chrome isn't running.**
   The extension only works when Chrome is open. If you quit Chrome, the data stops flowing. Reopen Chrome and it'll reconnect.

## The widget says "Extension not connected"

The desktop app can't hear the Chrome extension. Make sure:

- Chrome is running (doesn't need to be the active window, just running)
- The extension is installed and enabled at `chrome://extensions`
- Nothing else on your computer is using port 27843 (rare — only a problem if you run your own WebSocket servers on that port)
- On Windows: the firewall isn't blocking the app (see the SmartScreen / Firewall sections below)

## macOS says "HUD for Claude is damaged and can't be opened"

This can happen when the app isn't code-signed (which, for a side project distributed via Gumroad/GitHub, it usually isn't).

Fix: open Terminal and paste this command, then press Enter:

```bash
xattr -cr /Applications/Claude\ HUD.app
```

Then open HUD for Claude normally (right-click → Open the first time).

## macOS says "HUD for Claude cannot be opened because the developer cannot be verified"

Right-click (or Control-click) the app → click **Open** → in the dialog, click **Open** again.

You only need to do this the first time.

## Windows says "Windows protected your PC" (SmartScreen)

This is normal — the installer isn't signed with a paid Microsoft certificate ($200–500/year), so SmartScreen treats it as "unrecognized".

Fix: click **More info** → **Run anyway**.

You only need to do this once (during install). After installation, the installed app runs without any further SmartScreen warning.

## Windows Defender flagged the .exe / quarantined it

Same root cause as SmartScreen — unsigned indie installer. If Defender quarantines the file before you get to run it:

1. Open Windows Security → Virus & threat protection → Protection history
2. Find the HUD for Claude entry → Actions → Restore
3. Add an exclusion if you want to skip future scans: Windows Security → Virus & threat protection → Manage settings → Exclusions → Add an exclusion → File → pick the installer or the installed `HUD for Claude.exe`

Or grab the file again from GitHub Releases / Gumroad — Defender sometimes lets it through on a fresh download once it's seen enough downloads worldwide.

## Windows Firewall blocks port 27843 / extension not connected on Windows

The widget runs a local WebSocket server on port 27843 for the Chrome extension to push data to. On Windows, the first time the app starts, Windows Defender Firewall **may** pop up a "Windows Defender Firewall has blocked some features of this app" dialog.

Fix: click **Allow access** (Private networks is enough — you don't need Public).

If you accidentally clicked Cancel:

1. Open Windows Security → Firewall & network protection → Allow an app through firewall
2. Click **Change settings** → **Allow another app**
3. Browse to `HUD for Claude.exe` (default install path: `%LOCALAPPDATA%\Programs\HUD for Claude\`) and add it
4. Make sure **Private** is checked

## I see a Chrome tab at claude.ai/settings/usage I didn't open

Yes — that's the extension doing its job. It keeps that tab open and refreshes it every 30 seconds to scrape the usage numbers. Don't close it. If you accidentally close it, the extension will reopen it within 30 seconds.

If you really don't want to see the tab, you can pin it (right-click tab → Pin) so it takes up less room. Unfortunately Chrome does not allow truly hidden tabs for extensions.

## The numbers look wrong / the bars don't match what claude.ai actually shows

Go to claude.ai/settings/usage in Chrome. Do the numbers on that page match the bars on your HUD?

- **If they match**: everything's working.
- **If they don't match**: the extension's data is stale — click the extension icon in Chrome, which will force a fresh scrape.
- **If the page doesn't show numbers at all**: Anthropic may have changed the page layout. In that case the extension needs an update. Let me know: hello@claudehud.app

## How do I completely uninstall HUD for Claude?

**On Mac:**

1. Quit the app (red dot on the widget, or right-click menu → Quit)
2. Drag **HUD for Claude** from Applications to Trash
3. Go to `chrome://extensions` and remove the HUD for Claude extension
4. Optionally delete preferences: `~/Library/Application Support/HUD for Claude/`

If you enabled "Launch at Login", also go to **System Settings → General → Login Items** and remove HUD for Claude.

**On Windows:**

1. Quit the app (red dot on the widget, or right-click menu → Quit)
2. Settings → Apps → Installed apps → find **HUD for Claude** → click ⋯ → **Uninstall**
3. Go to `chrome://extensions` and remove the HUD for Claude extension
4. Optionally delete preferences: `%APPDATA%\HUD for Claude\` (paste that into File Explorer's address bar)

The installer un-registers the Launch-at-Login entry automatically on uninstall — no extra step needed.

## Still stuck?

Email hello@claudehud.app with:
- What you tried
- A screenshot of the HUD (whatever state it's in)
- What OS version you're on (Mac: Apple menu → About This Mac; Windows: Settings → System → About)

I read every email.
