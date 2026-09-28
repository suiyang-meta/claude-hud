#!/bin/bash
# HUD for Claude — finishes an update once the app has quit.
#
# Written out and started by widget/update/Updater.js, detached, so it outlives
# the app it replaces. Does what install.sh does by hand: copy the app out of
# the disk image into place, then open it. The .dmg was verified against the
# signed release before this ran.
#
#   $1 pid to wait for   $2 the verified .dmg   $3 the .app to replace
#   $4 scratch folder    $5 version expected    $6 log file
#
# Whatever fails, the old app ends up back where it was and is opened again,
# told why through HUD_UPDATE_FAILED so it can say so.
PID="$1"; DMG="$2"; APP="$3"; WORK="$4"; WANT="$5"; LOG="$6"
exec >>"$LOG" 2>&1
echo "=== $(date '+%F %T') updating to $WANT"

relaunch() {   # $1: why the update failed, empty when it did not
  local args=()
  # A test run's settings folder and update server must survive the relaunch.
  [ -n "${HUD_USER_DATA_DIR:-}" ] && args+=(--env "HUD_USER_DATA_DIR=$HUD_USER_DATA_DIR")
  [ -n "${HUD_UPDATE_BASE:-}" ] && args+=(--env "HUD_UPDATE_BASE=$HUD_UPDATE_BASE")
  [ -n "$1" ] && args+=(--env "HUD_UPDATE_FAILED=$1")
  # --env is newer than some macOS versions the app runs on; open it plainly
  # rather than not at all.
  open ${args[@]+"${args[@]}"} "$APP" || open "$APP"
}
fail() { echo "FAILED: $1"; relaunch "$1"; exit 1; }

# The bundle cannot be moved while the app is still running from it.
for _ in $(seq 1 150); do kill -0 "$PID" 2>/dev/null || break; sleep 0.2; done
kill -0 "$PID" 2>/dev/null && fail "the app did not quit"

MNT="$WORK/mnt"; NEW="$WORK/new.app"; OLD="$WORK/old.app"
rm -rf "$NEW" "$OLD"; mkdir -p "$MNT"
hdiutil attach "$DMG" -nobrowse -noverify -noautoopen -readonly -mountpoint "$MNT" >/dev/null \
  || fail "could not open the downloaded disk image"
SRC="$(ls -d "$MNT"/*.app 2>/dev/null | head -1)"
COPIED=1
[ -n "$SRC" ] && ditto "$SRC" "$NEW" && COPIED=0
hdiutil detach "$MNT" -quiet || hdiutil detach "$MNT" -force -quiet
[ "$COPIED" -eq 0 ] || fail "could not copy the new version out of the disk image"

GOT="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$NEW/Contents/Info.plist" 2>/dev/null)"
[ "$GOT" = "$WANT" ] || fail "the disk image held version '$GOT', not $WANT"
xattr -cr "$NEW"

mv "$APP" "$OLD" || fail "could not move the old version aside"
if ! mv "$NEW" "$APP"; then
  mv "$OLD" "$APP" || { echo "FAILED: could not restore it either; the old version is at $OLD"
                        open "$OLD"; exit 1; }
  fail "could not put the new version in place"
fi
rm -rf "$OLD" "$DMG" "$MNT"
echo "OK $WANT"
relaunch ""
