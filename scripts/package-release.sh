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
case "$WANT" in
  mac)  npx electron-builder --mac dmg --arm64 >/tmp/hud-package.log 2>&1 ;;
  win)  npx electron-builder --win zip --x64   >/tmp/hud-package.log 2>&1 ;;
  both) npx electron-builder --mac dmg --arm64 >/tmp/hud-package.log 2>&1
        npx electron-builder --win zip --x64  >>/tmp/hud-package.log 2>&1 ;;
  *) echo "usage: $0 [mac|win|both] [--skip-build]"; exit 2 ;;
esac
fi

assemble() {   # $1=label  $2=payload  $3...=files from release-assets/distribution
  local label="$1" payload="$2"; shift 2
  [ -f "$payload" ] || { echo "no payload: $payload"; exit 1; }
  local name="HUD-for-Claude-$VERSION-$label"
  local out="$HOME/Desktop/$name"
  rm -rf "$out" "$out.zip"
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

rm -f "$HOME/Desktop"/HUD-for-Claude-*.zip
echo "--- assembling ---"
[ "$WANT" = "mac" ] || [ "$WANT" = "both" ] && assemble mac "$(ls dist/*.dmg 2>/dev/null | head -1)" '安装说明.md' 'install.sh' 'diagnose.sh'
[ "$WANT" = "win" ] || [ "$WANT" = "both" ] && assemble win "dist/HUD for Claude-$VERSION-win.zip" '安装说明-Windows.md' 'install.ps1'
[ "$SKIP_BUILD" = "1" ] || rm -rf "$ROOT/widget/dist"
echo "OK"
