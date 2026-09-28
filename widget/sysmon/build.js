/* HUD for Claude · github.com/suiyang-meta/claude-hud · (c) 2026 Sui1491 · MIT */
// Compile the system-monitor helper (macOS only; a no-op elsewhere).
// Run by `npm start`, `npm run build:mac` and scripts/package-release.sh, so
// the binary is always built from the source beside it — it is not in git.
const { execFileSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') process.exit(0);
const src = path.join(__dirname, 'hud-sysmon.c');
const out = path.join(__dirname, 'hud-sysmon');
execFileSync('clang', ['-O2', '-Wall', '-arch', 'arm64', '-mmacosx-version-min=12.0',
  '-framework', 'IOKit', '-framework', 'CoreFoundation', '-o', out, src], { stdio: 'inherit' });
