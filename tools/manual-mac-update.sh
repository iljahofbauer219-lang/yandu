#!/bin/bash
# mac 安装版手动升级脚本（旧客户端 ≤1.0.15 的 Squirrel 自动更新路径已坏，升到含自托管安装器的版本需手动一次）。
# 流程：读 OSS feed → 下载 zip → sha512 校验 → 退出应用 → 旧 bundle 备份 .bak-<旧版本> → 替换 → 未签名则补 ad-hoc → 拉起。
# 用法：bash tools/manual-mac-update.sh [应用bundle路径]   默认 ~/Desktop/砚都跨境.app
#       SKIP_OPEN=1 bash tools/manual-mac-update.sh        测试用：替换后不拉起
set -euo pipefail

FEED="https://yandu-download.oss-cn-hangzhou.aliyuncs.com"
APP="${1:-$HOME/Desktop/砚都跨境.app}"

[ -d "$APP" ] || { echo "ABORT: 找不到应用 bundle: $APP"; exit 1; }
CURRENT="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"

WORK="$(mktemp -d /tmp/yandu-manual-update.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "[1/6] 读取 feed …"
YML="$(curl -fsSL "$FEED/latest-mac.yml")"
VERSION="$(printf '%s\n' "$YML" | awk '/^version:/{print $2; exit}')"
ZIPNAME="$(printf '%s\n' "$YML" | awk '/^path:/{print $2; exit}')"
SHA_WANT="$(printf '%s\n' "$YML" | awk '/^sha512:/{print $2; exit}')"
echo "      线上版本 v$VERSION（当前 v$CURRENT）"
[ "$VERSION" != "$CURRENT" ] || { echo "已是最新版本，无需操作。"; exit 0; }

echo "[2/6] 下载 $ZIPNAME …"
curl -fL --retry 3 -o "$WORK/update.zip" "$FEED/$ZIPNAME"

echo "[3/6] 校验 sha512 …"
SHA_GOT="$(shasum -a 512 "$WORK/update.zip" | awk '{print $1}' | xxd -r -p | base64)"
[ "$SHA_GOT" = "$SHA_WANT" ] || { echo "ABORT: sha512 不一致（下载损坏或 feed 被改）"; exit 2; }

echo "[4/6] 退出应用 …"
if pgrep -f "$APP/Contents/MacOS" >/dev/null; then
  osascript -e "quit app \"砚都跨境\"" 2>/dev/null || true
  for _ in $(seq 1 60); do pgrep -f "$APP/Contents/MacOS" >/dev/null || break; sleep 1; done
  pgrep -f "$APP/Contents/MacOS" >/dev/null && { echo "ABORT: 应用 60s 内未退出，请手动退出后重跑"; exit 3; }
fi

echo "[5/6] 解包并替换（旧版备份为 .bak-$CURRENT）…"
ditto -x -k "$WORK/update.zip" "$WORK/expanded"
NEW="$(find "$WORK/expanded" -maxdepth 1 -name '*.app' -print -quit)"
[ -n "$NEW" ] && [ -d "$NEW/Contents/MacOS" ] || { echo "ABORT: zip 内无有效 .app"; exit 4; }
BAK="${APP}.bak-${CURRENT}"
[ -e "$BAK" ] && BAK="${BAK}-$(date +%H%M%S)"
mv "$APP" "$BAK"
mv "$NEW" "$APP"
if ! codesign -v "$APP" >/dev/null 2>&1; then
  echo "      补 ad-hoc 签名 …"
  codesign --force --deep --sign - "$APP"
fi

echo "[6/6] 拉起新版 …"
if [ -z "${SKIP_OPEN:-}" ]; then open "$APP"; fi
echo "完成：v$CURRENT → v$VERSION；旧版备份在 $BAK（确认新版可用后可删）"
