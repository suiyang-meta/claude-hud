# Changelog

Version history for the HUD for Claude Chrome extension — the component
published to the Chrome Web Store. The desktop app is versioned separately.

## [1.3.1] - 2026-05-21

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
