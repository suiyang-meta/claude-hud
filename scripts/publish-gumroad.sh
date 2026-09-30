#!/usr/bin/env bash
# Replace the two hand-install bundles on the Gumroad product with this version's.
#
#   ./scripts/publish-gumroad.sh            # from release-assets/out/<version>/ (or the Desktop copies)
#   ./scripts/publish-gumroad.sh --dry-run  # show what would change, change nothing
#
# Called by publish-release.sh once R2 and GitHub are done; safe to rerun on its own.
# Uses the official Gumroad CLI (`brew install gumroad`, `gumroad auth login`).
#
# For each platform (mac, win) the product's current HUD-for-Claude-*-<platform> file is
# swapped for the new bundle in one call — one remove + one add, which is what lets
# the CLI also repoint the download button embedded in the product's content. A file
# already at this version with the same size is left alone, so a rerun is a no-op.
# Afterwards it reads the product back and checks both files are there, whole.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
PRODUCT="Jc2xCz16Nh-9DQUAfvy03g=="          # HUD for Claude · metasui.gumroad.com/l/hudclaude
OWNER="metasui1491@gmail.com"
VERSION=$(python3 -c "import json;print(json.load(open('widget/package.json'))['version'])")
DRY=""; [ "${1:-}" = "--dry-run" ] && DRY="--dry-run"
die() { echo "  ✗ $*"; exit 1; }

command -v gumroad >/dev/null || die "the Gumroad CLI is not installed (brew install gumroad)"
AUTH=$(gumroad auth status 2>&1 || true)
grep -q "$OWNER" <<<"$AUTH" || die "the Gumroad CLI is not signed in as $OWNER (gumroad auth login)"

bundle() {   # $1 platform -> path of this version's bundle
  for d in "release-assets/out/$VERSION" "$HOME/Desktop"; do
    [ -f "$d/HUD-for-Claude-$VERSION-$1.zip" ] && { echo "$d/HUD-for-Claude-$VERSION-$1.zip"; return; }
  done
  die "no HUD-for-Claude-$VERSION-$1.zip in release-assets/out/$VERSION or on the Desktop"
}
files() {   # id<TAB>name<TAB>size per file (the CLI's --jq prints JSON-quoted strings, so parse the JSON here)
  gumroad products view "$PRODUCT" --json | python3 -c 'import json,sys
for f in json.load(sys.stdin)["product"]["files"]: print(f"{f["id"]}\t{f["name"]}\t{f.get("size")}")'
}

echo "--- Gumroad: hand-install bundles for v$VERSION ---"
for plat in mac win; do
  f=$(bundle "$plat"); name="HUD-for-Claude-$VERSION-$plat"; size=$(stat -f %z "$f")
  cur=$(files | awk -F'\t' -v p="$plat" '$2 ~ "^HUD-for-Claude-.*-" p "$"')
  n=$(printf '%s' "$cur" | grep -c . || true)
  if [ "$n" -eq 1 ] && [ "$(cut -f2 <<<"$cur")" = "$name" ] && [ "$(cut -f3 <<<"$cur")" = "$size" ]; then
    echo "  = $name already there"; continue
  fi
  [ "$n" -gt 1 ] && die "the product has $n $plat files — tidy it by hand once (gumroad products view $PRODUCT)"
  if [ "$n" -eq 1 ]; then
    old=$(cut -f1 <<<"$cur")
    echo "  ↻ $(cut -f2 <<<"$cur") → $name"
    gumroad products update "$PRODUCT" --remove-file "$old" --file "$f" --file-name "$name" --yes $DRY >/dev/null
  else
    echo "  + $name"
    gumroad products update "$PRODUCT" --file "$f" --file-name "$name" --yes $DRY >/dev/null
  fi
done
[ -n "$DRY" ] && { echo "  (dry run — nothing changed)"; exit 0; }

# Gumroad reports a new file's size a little after the upload; wait for both.
for i in $(seq 1 20); do
  now=$(files)
  ok=1
  for plat in mac win; do
    want=$(stat -f %z "$(bundle "$plat")")
    awk -F'\t' -v n="HUD-for-Claude-$VERSION-$plat" -v s="$want" '$2==n && $3==s {f=1} END {exit !f}' <<<"$now" || ok=0
  done
  [ "$ok" -eq 1 ] && { echo "  ✓ both bundles on Gumroad, sizes match"; exit 0; }
  sleep 6
done
die "Gumroad did not show both v$VERSION bundles at the right size within 2 minutes — check the product page"
