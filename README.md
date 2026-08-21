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
npm run build:mac    # → widget/dist/HUD for Claude-2.0.0-arm64.dmg
npm run build:win    # → widget/dist/HUD for Claude Setup 2.0.0.exe
npm run build        # → both at once

# Or run from source (dev mode)
npm start
```

The Chrome extension lives in [`extension/`](extension/). Load it via `chrome://extensions` → Developer mode → Load unpacked, or just grab it from the Chrome Web Store linked above.

### Why no prebuilt downloads here on GitHub?

Deliberate. The Releases page intentionally doesn't attach `.dmg` / `.exe` binaries — that would collapse the time/money distinction above. If you want it packaged, Gumroad packages it (and lets you decide what it's worth, including $0 if you went there and saw the suggested price). If you want it free, the source is right here and the build is two commands. The Chrome extension stays free on the Web Store either way.

---

## How it works

The widget draws two kinds of numbers, and where each comes from depends on your OS.

### macOS — reads your machine directly

| | Source |
|---|---|
| **Plan allowance** (session %, weekly %, reset times) | The credential Claude Code keeps in your **macOS keychain**, used to ask Anthropic's API about your own account. macOS asks permission the first time. |
| **Token usage** (today, by model, 30 days, lifetime) | Your local Claude Code transcripts in `~/.claude/projects/` |
| **Chrome extension** | **Not needed.** No browser, no tab, no claude.ai login. |

Because Anthropic invalidates the previous credential whenever it renews one, the app
writes the replacement back to the same keychain entry — otherwise Claude Code would get
signed out.

### Windows — allowance still comes through the extension

The keychain is macOS-only, so the v2 path stays in place for the allowance half:

| | Source |
|---|---|
| **Plan allowance** | **Chrome extension** — keeps a tab on your claude.ai usage page, scrapes the percentages, pushes them to the widget over `ws://localhost:27843` |
| **Token usage** | Same as macOS: your local `~/.claude/projects/` transcripts. This leg is plain file reading and is not macOS-specific. |
| **Chrome extension** | **Required** for the allowance bars. Without it you still get the token/cost half. |

> The Windows code path is platform-neutral by construction (the keychain call refuses on
> non-Darwin and falls through to the extension; transcript scanning uses the OS home
> directory), and the fallback was verified against the extension's real payload shape.
> It has **not** been re-tested on a physical Windows machine since the data layer
> changed — if you run it there and something is off, that is the first thing to suspect.

Either way: prompt and reply text is never read, and the only host contacted is
`api.anthropic.com`, with your own credential, about your own account. Nothing goes to
the developer — no servers, no analytics, no telemetry.

Requires Claude Code installed and signed in — the widget has no login of its own.

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
