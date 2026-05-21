# HUD for Claude

A floating desktop widget that shows your Claude.ai usage as real-time blood bars — current session, weekly all-models, weekly Sonnet, and routine runs — so you stop breaking your flow to click into settings every 20 minutes.

**Mac (Apple Silicon) + Windows (x64).** MIT licensed. Not affiliated with Anthropic.

Landing page: [suiyang-meta.github.io/claude-hud](https://suiyang-meta.github.io/claude-hud/)

---

## Two ways in

This project has two distinct entry points — pick whichever matches your time/money trade-off.

### 👋 Want a prebuilt installer? → Gumroad

[**metasui.gumroad.com/l/evlikv**](https://metasui.gumroad.com/l/evlikv) — pay-what-you-want bundles for Mac (Apple Silicon `.dmg`) and Windows (x64 `.exe`), with the Chrome extension and setup README bundled in. No build tools required. Setup is ~2 minutes.

The Chrome extension half is also available free on the [**Chrome Web Store**](https://chromewebstore.google.com/detail/hud-for-claude/pbboagijhngmapjomijmohfhajapfajl) — install that once you have the desktop app from Gumroad.

### 🛠️ Want it free? → Build from source

This repo is the source. You'll need Node 18+ and npm.

```bash
git clone https://github.com/suiyang-meta/claude-hud.git
cd claude-hud/widget
npm install

# Build for your platform
npm run build:mac    # → widget/dist/HUD for Claude-1.2.0-arm64.dmg
npm run build:win    # → widget/dist/HUD for Claude Setup 1.2.0.exe
npm run build        # → both at once

# Or run from source (dev mode)
npm start
```

The Chrome extension lives in [`extension/`](extension/). Load it via `chrome://extensions` → Developer mode → Load unpacked, or just grab it from the Chrome Web Store linked above.

### Why no prebuilt downloads here on GitHub?

Deliberate. The Releases page intentionally doesn't attach `.dmg` / `.exe` binaries — that would collapse the time/money distinction above. If you want it packaged, Gumroad packages it (and lets you decide what it's worth, including $0 if you went there and saw the suggested price). If you want it free, the source is right here and the build is two commands. The Chrome extension stays free on the Web Store either way.

---

## How it works

Two pieces talk to each other on `localhost`:

1. **Chrome extension** quietly keeps a tab open on your claude.ai usage page, refreshes it every 30 seconds, and scrapes the four usage percentages off the rendered page.
2. **Desktop widget** (Electron) runs a local WebSocket server on port 27843 and receives those numbers — then draws them as color-coded bars (green &lt;50%, yellow 50–79%, red 80%+).

Nothing leaves your machine. No accounts, no servers, no analytics, no telemetry. The extension can read only your claude.ai usage page — not your conversations.

Full privacy policy: [release-assets/privacy/privacy-policy.html](release-assets/privacy/privacy-policy.html) (or live at [suiyang-meta.github.io/claude-hud/privacy](https://suiyang-meta.github.io/claude-hud/privacy)).

---

## Repo layout

```
widget/             Electron desktop app (main.js, preload.js, index.html, icon)
extension/          Chrome extension (manifest v3, background, content scripts)
release-assets/     Distribution copy: install README, troubleshooting,
                    landing page source, privacy policy, store listings
docs/               GitHub Pages deploy of the landing page (synced from release-assets/landing-page/)
```

---

## Code signing

The desktop app is **not** signed on either platform (no $99/yr Apple Developer cert, no $200+/yr Microsoft cert on a side project). On first launch:

- **Mac**: macOS may show "HUD for Claude is damaged" — it isn't, that's Gatekeeper blocking unsigned apps. Run `xattr -cr "/Applications/HUD for Claude.app"` in Terminal once, then open normally. The setup README has the full walkthrough.
- **Windows**: SmartScreen will pop up "Windows protected your PC" on the installer — click *More info* → *Run anyway*.

If you'd rather not run an unsigned binary, build it yourself from this source (see above).

---

## Contributing

This is a small personal project. Bug reports and PRs are welcome but no roadmap promises. If something's broken, open an issue with:

- What OS + version
- What you tried
- A screenshot if it's a visual issue

---

## License

MIT — see [LICENSE](LICENSE) (or `widget/package.json`).

Claude™ is a trademark of Anthropic PBC. HUD for Claude is an independent third-party tool and is not affiliated with, endorsed by, or sponsored by Anthropic.
