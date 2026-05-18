# Troubleshooting — Claude HUD

## The widget says "Waiting for data" and never updates

This almost always means one of three things:

1. **You're not signed into claude.ai in Chrome.**
   Open Chrome, go to https://claude.ai, sign in. Wait 30 seconds.

2. **The Chrome extension isn't installed or isn't enabled.**
   Go to `chrome://extensions` — is "Claude HUD" in the list? Is the toggle flipped on?

3. **Chrome isn't running.**
   The extension only works when Chrome is open. If you quit Chrome, the data stops flowing. Reopen Chrome and it'll reconnect.

## The widget says "Extension not connected"

The Mac app can't hear the Chrome extension. Make sure:

- Chrome is running (doesn't need to be the active window, just running)
- The extension is installed and enabled at `chrome://extensions`
- Nothing else on your Mac is using port 27843 (rare — only a problem if you run your own WebSocket servers on that port)

## macOS says "Claude HUD is damaged and can't be opened"

This can happen when the app isn't code-signed (which, for a side project distributed via Gumroad/GitHub, it usually isn't).

Fix: open Terminal and paste this command, then press Enter:

```bash
xattr -cr /Applications/Claude\ HUD.app
```

Then open Claude HUD normally (right-click → Open the first time).

## macOS says "Claude HUD cannot be opened because the developer cannot be verified"

Right-click (or Control-click) the app → click **Open** → in the dialog, click **Open** again.

You only need to do this the first time.

## I see a Chrome tab at claude.ai/settings/usage I didn't open

Yes — that's the extension doing its job. It keeps that tab open and refreshes it every 30 seconds to scrape the usage numbers. Don't close it. If you accidentally close it, the extension will reopen it within 30 seconds.

If you really don't want to see the tab, you can pin it (right-click tab → Pin) so it takes up less room. Unfortunately Chrome does not allow truly hidden tabs for extensions.

## The numbers look wrong / the bars don't match what claude.ai actually shows

Go to claude.ai/settings/usage in Chrome. Do the numbers on that page match the bars on your HUD?

- **If they match**: everything's working.
- **If they don't match**: the extension's data is stale — click the extension icon in Chrome, which will force a fresh scrape.
- **If the page doesn't show numbers at all**: Anthropic may have changed the page layout. In that case the extension needs an update. Let me know: hello@claudehud.app

## How do I completely uninstall Claude HUD?

1. Quit the app (red dot on the widget, or right-click menu → Quit)
2. Drag **Claude HUD** from Applications to Trash
3. Go to `chrome://extensions` and remove the Claude HUD extension
4. Optionally delete preferences: `~/Library/Application Support/Claude HUD/`

If you enabled "Launch at Login", also go to **System Settings → General → Login Items** and remove Claude HUD.

## Still stuck?

Email hello@claudehud.app with:
- What you tried
- A screenshot of the HUD (whatever state it's in)
- What macOS version you're on (Apple menu → About This Mac)

I read every email.
