# Changelog

Version history for HUD for Claude. The desktop app and the Chrome extension
are versioned independently.

---

# Desktop app

## [Unreleased]

### Added

- **System Monitor: what is slowing this machine down.** Off until you turn it
  on (right-click → System Monitor). A third ring on the notch names the
  reading under the most pressure — CPU, memory, GPU, disk space or heat — and
  who is behind it: an app, a dev server by its project folder, or a Claude
  Code session by the project it is working in. Its card and panel list the
  biggest users of each, memory pressure and swap, what is reading and writing
  the disk, and on a Mac the chip, SSD and battery temperatures. Amber means
  under pressure, red critical; nothing pops up. Click a name to open Activity
  Monitor. On a Mac, Find what's using space measures build output and
  dependencies across your code folders, caches, Downloads and the like — about
  half a minute, nothing deleted. Everything stays on the machine.
  (Windows: CPU, memory and disk only, not yet run on real Windows hardware.)

## [3.7.0] - 2026-09-28

### Added

- **Updates from inside the app.** The HUD asks the developer's download server
  for a newer version every few hours and downloads it in the background. When it is ready,
  right-click → Restart to Update, or click the line at the foot of the Claude
  panel; the HUD quits, swaps in the new version and reopens in a few seconds,
  settings intact. Nothing is installed until you choose to. Every release is
  signed with the developer's own key, and a download that does not match its
  signature is refused. Right-click → Updates holds Check Now and Check
  Automatically. This version still installs by hand once, since the copies
  before it have no updater; later ones install from inside the app.
  (Windows: the same design, not yet run on real Windows hardware.)
- **The notch on any screen.** Drag it onto another display and it docks on
  that display's edge, or pick one from right-click → Notch Display; the panel
  opens beside it there. It remembers the screen: unplug it and the notch goes
  to the main screen, plug it back in and the notch returns.

### Fixed

- With both panels open against a screen to the left of the main one, the
  second panel was placed on the main screen instead.

## [3.6.0] - 2026-09-21

### Changed

- Much lighter at rest. The pet and its button are now closed while the panel
  is folded rather than hidden; measured idle draw went from about 5% of a core
  to under 1%.

## [3.5.1] - 2026-09-21

### Added

- Right-click → Show Dock Icon (macOS) turns the Dock tile off.

### Fixed

- Claude Fable 5.1 reads cache at 0.025× input, not 0.1×; its spend had been
  overstated by about 75%. Sonnet 5 is priced at $2 / $10 per million tokens.

## [3.5.0] - 2026-09-21

### Changed

- The Codex sign-in is renewed before it expires, the way the Codex CLI does
  it, so the Codex ring no longer goes stale on a machine without the CLI.

## [3.4.2] - 2026-09-21

### Added

- The same sign-in item for Codex. Both items now run the CLI's login command
  directly rather than an interactive session.

## [3.4.1] - 2026-09-21

### Fixed

- The sign-in item finds Claude Code where its installer put it, even when a
  new terminal's PATH does not include that folder, and says so plainly when it
  is not installed.

## [3.4.0] - 2026-09-21

### Added

- Right-click → Sign in to Claude Code opens a terminal running its login,
  for when the quota has gone stale.
- The open card is a drag handle too: drag the HUD by it.

## [3.3.0] - 2026-09-19

### Added

- **Edge notch.** The HUD now rests as a thin sliver on the screen edge.
  Touch it and it slides out into a notch with one ring per provider; hover a
  ring for its card (limit windows and reset times). The notch uses the
  panel's own material, and its outline follows two rules: the convex bend is
  concentric with the rings, and the concave bend off the edge has the same
  radius, joined by a straight slope.
- **Codex usage.** If Codex is signed in with ChatGPT on this machine, a second
  ring shows its 5-hour and weekly limits, read with Codex's own sign-in
  (`~/.codex/auth.json`, read-only) from the endpoint Codex itself uses. Codex
  has its own panel in its own colours; it is never merged into Claude's.
- **Pinning.** Click a ring to pin its card; both cards can be pinned at once.
  The small circle at the bottom of the notch pins the notch open. Pins,
  position and edge are remembered across restarts.
- **Detach.** Double-click a ring, or use the card's expand icon, to open that
  provider's full panel; the notch folds away.
- **Left or right edge.** Drag the notch across the middle of the screen, or
  pick a side from the right-click menu.

### Changed

- The panel's red dot now folds the panel back to the edge. Quit is in the
  right-click menu.
- The panel's grain is lighter and its ground a little deeper, closer to the
  notch.

## [2.0.0] - 2026-05-24

### Added

- **HUD Pet runtime.** A new floating companion window sits next to the HUD
  and reacts to your Claude.ai usage in real time. Default bundled pet is
  **Claw'd** (a coral-orange pixel crab by [krrsantan][1] on codex-pets.net).
- **Codex Pet format support.** Drop any `.codex-pet.zip` from a marketplace
  (codex-pets.net, codexpet.xyz, petdex) or generated via OpenAI's
  `/hatch-pet` skill into the in-app **Pet Library** to swap pets. Library
  holds up to 6 pets with one-click activate / hover-delete.
- **Quota-driven pet states.** Three behaviour modes:
  - *Comfy* (session < 80%): idle (70%) + waiting (20%) + occasional wave/jump
  - *Anxious* (session 80–95%): running (70%) + failed (30%)
  - *Fatigue* (session ≥ 95% or weekly ≥ 85%): sticky failed
  Plus warning flashes for routines/extra quota crossings, random
  ~5–60 min "pet me" prompts with bubble chat, and click-to-poke (wave/jump).
- **Drag-aware walking.** Dragging the HUD makes the pet walk left or right
  in the direction of the drag (via the Codex Pet `running-left` /
  `running-right` rows). Direction is debounced with a decaying rolling sum
  + deadband so per-pixel cursor jitter doesn't flap the animation.
- **Seven anchor positions.** Pet can sit at TL / LC / BL / BC / BR / RC / TC
  relative to the HUD. Right-click HUD → *Pet Anchor* to pick. Anchor
  auto-flips to the opposite side if the HUD is pressed against a screen
  edge, so the pet is never cut off.
- **Adaptive frame detection.** Pet renderer scans each sprite row at load
  time and detects the actual frame count (Codex pets in the wild often
  have fewer than 8 frames per row); animation cycles use the detected
  length instead of always assuming 8.

### Changed

- Default pet button now lives in its own small BrowserWindow anchored to
  the HUD's outside edge (rather than inside the HUD card). It reveals on
  hover (HUD-edge strip only — hovering the HUD center does not trigger
  it) with scale-in / fade-in animation, and is held fully invisible
  (window-level `setOpacity(0)`) otherwise.
- Toggle pet off by clicking the active pet slot in the library; toggle on
  by clicking any inactive slot.
- Walking animation runs at 6fps (slower than the 8fps default) so the
  2-pose alternation common in Codex pet `running-*` rows reads as
  deliberate footsteps rather than stroboscopic flicker.
- Pet import derives id + displayName from the package filename (e.g.
  `the-guy.codex-pet.zip` → id "the-guy", displayName "The Guy"), so
  user-meaningful names beat the UUID-tagged ids most marketplaces use.

### Fixed

- Drag-end snap. Releasing the HUD now sends an explicit "drag is over"
  signal (no HUD `move` event for 50 ms) so the pet snaps back to its
  baseline animation immediately instead of lingering in walk state for
  the duration of a hold timer.
- Stale pet pointer on upgrade. If `prefs.json` references a pet id whose
  folder no longer exists on disk (e.g. a previous default was renamed in
  an update), the app falls back to the bundled default rather than
  silently leaving no pet active.

### Notes

Widget version jumps 1.2.0 → 2.0.0 because the pet runtime is a major
new product surface, not a maintenance update.

[1]: https://codex-pets.net/#/pets/claw-d

## [1.2.0] - 2026-05-19

### Added

- Windows support (x64 NSIS installer, per-user, no admin required).
- Mac Apple Silicon (arm64) DMG.
- Open at login (defaults on; toggleable via right-click menu).
- Right-click context menu on HUD (launch-at-login toggle, open claude.ai
  usage page, reload widget, quit).
- WebSocket connection-state indicator (green pulse when extension
  connected; grey when not).

---

# Chrome extension

## [1.4.0] - 2026-05-24

### Changed

- Usage page discovery is now dynamic. Claude.ai's settings page moved twice in
  two days (standalone route → hash-route modal → back to standalone), so the
  extension no longer hardcodes a URL. It opens `/settings/usage` (or the last
  URL that worked, cached from the previous refresh); if the page doesn't show
  usage data, the content script walks the settings sidebar for a "Usage" link
  and clicks it. Future Claude.ai URL changes shouldn't require a new extension
  release.
- HUD-managed background tabs are now marked with a `?hud=1` query parameter so
  the extension can tell its own tabs apart from claude.ai tabs the user opened.
  Only HUD-tagged tabs auto-click "Usage" or get cleaned up as duplicates;
  user-opened tabs are left alone.

### Fixed

- 1.3.1's hardcoded hash-route URL (`claude.ai/new#settings/usage`) stopped
  working when Claude.ai reverted that redesign back to the standalone
  `/settings/usage` page. 1.4.0 supersedes 1.3.1 — users updating from 1.2.0
  skip straight to 1.4.0.

## [1.3.1] - 2026-05-24

### Fixed

- The extension no longer opens repeated claude.ai tabs. Claude.ai moved its
  usage page into a hash-route settings modal (`claude.ai/new#settings/usage`),
  which broke the extension's tab detection — each time Chrome restarted the
  extension's service worker, it failed to recognize the tab it had already
  opened and spawned a new one. Tab detection now matches both the old and new
  URL forms, and is derived fresh from the open tabs each cycle instead of
  relying on in-memory state. Any existing pile of duplicate tabs is cleaned up
  automatically.
- The 30-second usage refresh is now scheduled with `chrome.alarms` instead of
  `setInterval`, so it keeps working after Chrome suspends the extension's
  service worker.
