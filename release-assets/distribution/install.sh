#!/bin/bash
# Installer for HUD for Claude. Finds the .dmg sitting next to it, so it does
# not need updating when the version changes.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="HUD for Claude.app"
DEST="/Applications/$APP"
B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'

DMG="$(ls "$DIR"/*.dmg 2>/dev/null | head -1)"
if [ -z "$DMG" ]; then
  printf "  ${R}✗${N} 找不到 .dmg —— 请确保 install.sh 和 .dmg 在同一个文件夹里\n"; exit 1
fi

printf "\n${B}1/4  检查前提${N}\n"
if security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1; then
  printf "  ${G}✓${N} 找到 Claude Code 凭证\n"
else
  printf "  ${Y}!${N} 没找到 Claude Code 凭证\n"
  printf "      配额那两条会是空的。请先安装 Claude Code 并登录一次：\n"
  printf "      https://claude.com/claude-code\n"
fi
COUNT=$(find "$HOME/.claude/projects" -name '*.jsonl' 2>/dev/null | wc -l | tr -d ' ')
if [ "${COUNT:-0}" -gt 0 ]; then
  printf "  ${G}✓${N} 找到 %s 份本地使用记录\n" "$COUNT"
else
  printf "  ${Y}!${N} 还没有本地使用记录 —— 用量统计会是 0，用一阵 Claude Code 就有了\n"
fi

printf "\n${B}2/4  安装到 /Applications${N}\n"
MNT=$(hdiutil attach "$DMG" -nobrowse -noverify -plist 2>/dev/null \
      | plutil -extract system-entities json -o - - 2>/dev/null \
      | python3 -c 'import sys,json;e=json.load(sys.stdin);print(next((x["mount-point"] for x in e if x.get("mount-point")),""))' 2>/dev/null)
if [ -z "$MNT" ] || [ ! -d "$MNT/$APP" ]; then
  printf "  ${R}✗${N} 挂载 .dmg 失败 —— 请手动双击 .dmg 并把 app 拖进「应用程序」\n"; exit 1
fi
pkill -f "$APP" 2>/dev/null; sleep 1
[ -d "$DEST" ] && { printf "      · 发现旧版本，先移除\n"; rm -rf "$DEST"; }
cp -R "$MNT/$APP" /Applications/
hdiutil detach "$MNT" -quiet 2>/dev/null
printf "  ${G}✓${N} 已安装到 %s\n" "$DEST"

printf "\n${B}3/4  解除 Gatekeeper 隔离${N}\n"
xattr -cr "$DEST" 2>/dev/null
printf "  ${G}✓${N} 已解除隔离标记（否则会报「已损坏」）\n"

printf "\n${B}4/4  完成${N}\n"
printf "  ${G}✓${N} 现在可以打开了\n\n"
printf "      首次启动时 macOS 会问是否允许读取钥匙串 —— 请点「始终允许」。\n"
printf "      不给权限的话配额条会空着，但用量统计仍然正常。\n\n"
printf "      现在打开它？ [Y/n] "
read -r ANS
case "${ANS:-y}" in
  [Nn]*) printf "      稍后可在「应用程序」里打开。\n\n" ;;
  *)     open "$DEST"; printf "      已启动。\n\n" ;;
esac
