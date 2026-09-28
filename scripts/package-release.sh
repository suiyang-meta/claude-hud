#!/bin/bash
# Build and assemble a distributable zip on the Desktop.
#
#   ./scripts/package-release.sh              both platforms
#   ./scripts/package-release.sh mac          macOS only
#   ./scripts/package-release.sh win          Windows only
#   ./scripts/package-release.sh both --skip-build
#                                             re-assemble from an existing dist/,
#                                             for iterating on the packaging itself
#
# Also stages the release in release-assets/out/<version>/ — the update files
# the in-app updater fetches, plus copies of the two bundles for Gumroad — and,
# once both platforms are there, signs its latest.json with the keychain's
# update key. Publishing is a separate, deliberate step: scripts/publish-release.sh.
#
# Exists because assembling this by hand once produced a zip containing only the
# installer payload — the guide and install script had been staged in a temp dir
# and were swept away. Distribution files live in the repo now, and this script,
# which verifies its own output, is the only path.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WANT="${1:-both}"
SKIP_BUILD=0
[ "${2:-}" = "--skip-build" ] && SKIP_BUILD=1
cd "$ROOT/widget"
VERSION=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
DIST="$ROOT/release-assets/distribution"

if [ "$SKIP_BUILD" = "1" ]; then
  echo "re-assembling $VERSION ($WANT) from existing dist/"
else
echo "building $VERSION ($WANT)…"
pkill -f 'HUD for Claude' 2>/dev/null || true; sleep 1
rm -rf dist
# Architecture flags apply to every target in one invocation, so building both
# platforms at once would also produce an arm64 Windows zip and an x64 dmg that
# nobody asked for. Two passes keeps each platform to the arch that matters.
# The Mac build carries the system-monitor helper, compiled fresh from its
# source (it is not in git); electron-builder fails if it is missing.
case "$WANT" in
  mac)  node sysmon/build.js
        npx electron-builder --mac dmg --arm64 >/tmp/hud-package.log 2>&1 ;;
  win)  npx electron-builder --win zip --x64   >/tmp/hud-package.log 2>&1 ;;
  both) node sysmon/build.js
        npx electron-builder --mac dmg --arm64 >/tmp/hud-package.log 2>&1
        npx electron-builder --win zip --x64  >>/tmp/hud-package.log 2>&1 ;;
  *) echo "usage: $0 [mac|win|both] [--skip-build]"; exit 2 ;;
esac
fi

assemble() {   # $1=label  $2=payload  $3...=files from release-assets/distribution
  local label="$1" payload="$2"; shift 2
  [ -f "$payload" ] || { echo "no payload: $payload"; exit 1; }
  local name="HUD-for-Claude-$VERSION-$label"
  local out="$HOME/Desktop/$name"
  # Clear earlier versions of THIS platform only. A single-platform run used to
  # sweep every HUD zip off the Desktop, the other platform's included.
  rm -rf "$out"; rm -f "$HOME/Desktop"/HUD-for-Claude-*-"$label".zip
  mkdir -p "$out"
  cp "$payload" "$out/"
  local f
  for f in "$@"; do
    cp "$DIST/$f" "$out/"
    case "$f" in *.sh) chmod +x "$out/$f" ;; esac
  done
  (cd "$HOME/Desktop" && zip -qr "$name.zip" "$name")
  rm -rf "$out"
  # Count only the file-listing rows. `unzip -l` opens with "Archive: <name>.zip",
  # which otherwise matches the extension pattern and inflates the total by one.
  local want=$(( $# + 1 )) n
  n=$(unzip -l "$out.zip" | grep -E '^ *[0-9]+ ' | grep -cE '\.(dmg|zip|md|sh|ps1)$')
  printf "  %-4s -> %s  (%d files)\n" "$label" "$name.zip" "$n"
  [ "$n" -eq "$want" ] || { echo "  INCOMPLETE — expected $want"; exit 1; }
}

echo "--- assembling ---"
[ "$WANT" = "mac" ] || [ "$WANT" = "both" ] && assemble mac "$(ls dist/*.dmg 2>/dev/null | head -1)" '安装说明.md' 'install.sh' 'diagnose.sh'
[ "$WANT" = "win" ] || [ "$WANT" = "both" ] && assemble win "dist/HUD for Claude-$VERSION-win.zip" 'README-Windows.md' 'install.ps1'

# ---- Release stage: what publish-release.sh uploads ----
# The two bundles above are for people installing by hand (Gumroad); the bare
# .dmg and .zip are what the in-app updater fetches from R2, listed in a signed
# latest.json.
STAGE="$ROOT/release-assets/out/$VERSION"
mkdir -p "$STAGE"
# Only the current version's stage is kept; each is a few hundred MB.
find "$ROOT/release-assets/out" -mindepth 1 -maxdepth 1 -type d ! -name "$VERSION" -exec rm -rf {} +
if [ "$WANT" = "mac" ] || [ "$WANT" = "both" ]; then
  cp "$(ls dist/*.dmg | head -1)" "$STAGE/HUD-for-Claude-$VERSION-arm64.dmg"
  cp "$HOME/Desktop/HUD-for-Claude-$VERSION-mac.zip" "$STAGE/"
fi
if [ "$WANT" = "win" ] || [ "$WANT" = "both" ]; then
  cp "dist/HUD for Claude-$VERSION-win.zip" "$STAGE/HUD-for-Claude-$VERSION-win-x64.zip"
  cp "$HOME/Desktop/HUD-for-Claude-$VERSION-win.zip" "$STAGE/"
fi
rm -f "$STAGE/latest.json" "$STAGE/latest.json.sig"   # a rebuilt file voids the old signature (.sig: pre-envelope leftovers)
if [ -f "$STAGE/HUD-for-Claude-$VERSION-arm64.dmg" ] && [ -f "$STAGE/HUD-for-Claude-$VERSION-win-x64.zip" ]; then
  # The private key goes keychain -> stdin -> node; never a file or an argument.
  if security find-generic-password -s hud-for-claude-update-key -a release >/dev/null 2>&1; then
    security find-generic-password -s hud-for-claude-update-key -a release -w \
      | node "$ROOT/scripts/release-manifest.js" sign "$STAGE" "$VERSION"
  else
    echo "  ! no signing key in this keychain (hud-for-claude-update-key) — staged unsigned; cannot be published"
  fi
else
  echo "  (one platform staged — latest.json is signed once both are there)"
fi
echo "  stage -> release-assets/out/$VERSION"

[ "$SKIP_BUILD" = "1" ] || rm -rf "$ROOT/widget/dist"
echo "OK"
