#!/bin/bash
# Publish the staged release: the update files to the R2 bucket the in-app
# updater reads, and a source-only release — notes, no binaries — to GitHub.
#
#   ./scripts/publish-release.sh
#
# Publishes widget/package.json's version from release-assets/out/<version>/,
# which `./scripts/package-release.sh both` fills and signs. The two bundles for
# people installing by hand are not uploaded anywhere: they go to Gumroad, by
# hand, as before. GitHub stays source-only; the README says so, on purpose.
#
# Once latest.json is replaced, every copy that checks will download this
# version, so it refuses unless everything holds first:
#   · both update files and latest.json are staged, and latest.json verifies
#     against the key the app carries, with both files matching it
#   · the bucket does not already serve a newer version
#   · the commit being released is on GitHub, and this tag is not released yet
#   · wrangler is signed in to the account that owns the bucket
# The installers go up before latest.json, so no copy is ever told about a file
# that is not there yet. Afterwards it reads latest.json back through the same
# public URL the app uses, verifies it again, and checks each file is served
# whole.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
REPO="suiyang-meta/claude-hud"
BUCKET="hud-for-claude-updates"
PUBLIC="https://pub-73af813618eb49f9a18951f929fab6e6.r2.dev"   # must match widget/update/Updater.js
ACCOUNT="23022c555e66276f7bcdea49cb4282df"                     # Metasui1491@gmail.com's Account
GUMROAD="https://metasui.gumroad.com/l/evlikv"
VERSION=$(python3 -c "import json;print(json.load(open('widget/package.json'))['version'])")
STAGE="release-assets/out/$VERSION"
DMG="HUD-for-Claude-$VERSION-arm64.dmg"
WINZIP="HUD-for-Claude-$VERSION-win-x64.zip"
die() { echo "  ✗ $*"; exit 1; }

echo "--- checking v$VERSION ---"
for f in "$DMG" "$WINZIP" latest.json; do
  [ -f "$STAGE/$f" ] || die "missing $STAGE/$f — run ./scripts/package-release.sh both first"
done
node scripts/release-manifest.js verify "$STAGE" "$VERSION"

LIVE=$(curl -fsSL "$PUBLIC/latest.json" 2>/dev/null | node -e "let s='';process.stdin
  .on('data',(d)=>s+=d).on('end',()=>{try{console.log(JSON.parse(JSON.parse(s).manifest).version)}catch{}})" || true)
if [ -n "$LIVE" ] && [ "$(printf '%s\n%s\n' "$LIVE" "$VERSION" | sort -V | tail -1)" != "$VERSION" ]; then
  die "the bucket already serves $LIVE, newer than $VERSION — publishing would hide it"
fi

wrangler whoami 2>/dev/null | grep -q "$ACCOUNT" || die "wrangler is not signed in to the account that owns $BUCKET ($ACCOUNT)"
git fetch -q origin
git merge-base --is-ancestor HEAD origin/main || die "this commit is not on origin/main yet — push first"
gh release view "v$VERSION" -R "$REPO" >/dev/null 2>&1 && die "v$VERSION is already released on GitHub"
SECTION=$(awk -v v="$VERSION" '$0 ~ "^## \\[" v "\\]" {on=1; next} on && /^## / {exit} on' CHANGELOG.md)
[ -n "$SECTION" ] || die "CHANGELOG.md has no section for $VERSION"

put() {   # $1 file  $2 key in the bucket  $3 content type  $4 cache control
  wrangler r2 object put "$BUCKET/$2" --file "$1" --content-type "$3" --cache-control "$4" --remote >/dev/null \
    || die "upload of $2 failed"
  echo "  ✓ $2"
}
echo "--- uploading to R2 ($BUCKET) ---"
put "$STAGE/$DMG" "v$VERSION/$DMG" application/x-apple-diskimage "public, max-age=31536000, immutable"
put "$STAGE/$WINZIP" "v$VERSION/$WINZIP" application/zip "public, max-age=31536000, immutable"
put "$STAGE/latest.json" latest.json application/json "no-cache"

echo "--- reading it back the way the app will ---"
TMP=$(mktemp -d)
curl -fsSL "$PUBLIC/latest.json" -o "$TMP/latest.json"
node scripts/release-manifest.js verify "$TMP" "$VERSION" --remote
rm -rf "$TMP"
for f in "$DMG" "$WINZIP"; do
  want=$(stat -f%z "$STAGE/$f")
  got=$(curl -fsSI "$PUBLIC/v$VERSION/$f" | awk 'tolower($1)=="content-length:" {print $2}' | tr -d '\r')
  [ "$got" = "$want" ] || die "$f is served at ${got:-no} bytes, not $want"
  echo "  ✓ $f served whole ($got bytes)"
done

echo "--- GitHub: source-only release ---"
NOTES="$SECTION

---

**Prebuilt installers** are on [Gumroad]($GUMROAD) — pay what you want. Or build from source; see the README.
Already on 3.7.0 or later? The app updates itself: right-click → Restart to Update."
gh release create "v$VERSION" -R "$REPO" --target "$(git rev-parse HEAD)" \
  --title "HUD for Claude v$VERSION" --notes "$NOTES"
echo "OK — v$VERSION is live; every copy from 3.7.0 on will find it on its next check"
