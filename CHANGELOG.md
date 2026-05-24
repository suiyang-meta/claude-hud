# Changelog

Version history for the HUD for Claude Chrome extension — the component
published to the Chrome Web Store. The desktop app is versioned separately.

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
