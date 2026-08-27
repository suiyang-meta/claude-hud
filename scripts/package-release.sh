#!/bin/bash
# Build the mac DMG and assemble the distributable zip on the Desktop.
#
# Exists because assembling this by hand once produced a zip containing only the
# .dmg — the guide and installer had been staged in /tmp and were swept away by
# the system. Distribution files live in the repo now, and this script, which
# verifies its own output, is the only path.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/widget"
VERSION=$(python3 -c "import json;print(json.load(open('package.json'))['version'])")
echo "building $VERSION…"
pkill -f 'HUD for Claude' 2>/dev/null || true; sleep 1
rm -rf dist && npm run build:mac >/tmp/hud-package.log 2>&1
DMG=$(ls dist/*.dmg | head -1)
OUT="$HOME/Desktop/HUD-for-Claude-$VERSION"
rm -rf "$OUT" "$HOME/Desktop"/HUD-for-Claude-*.zip
mkdir -p "$OUT"
cp "$DMG" "$OUT/"
cp "$ROOT/release-assets/distribution/安装说明.md" "$OUT/"
cp "$ROOT/release-assets/distribution/install.sh" "$OUT/"
chmod +x "$OUT/install.sh"
cd "$HOME/Desktop" && zip -qr "HUD-for-Claude-$VERSION.zip" "HUD-for-Claude-$VERSION" && rm -rf "$OUT"
rm -rf "$ROOT/widget/dist"
echo "--- contents ---"
unzip -l "$HOME/Desktop/HUD-for-Claude-$VERSION.zip" | sed -n '4,9p'
COUNT=$(unzip -l "$HOME/Desktop/HUD-for-Claude-$VERSION.zip" | grep -cE '\.(dmg|md|sh)$')
[ "$COUNT" -eq 3 ] && echo "OK — all 3 files present" || { echo "INCOMPLETE: $COUNT/3"; exit 1; }
