#!/bin/bash
# mac 自托管更新安装器（根治 Squirrel 竞态：应用进程内解包被退出杀死 + 未签名包校验失败）。
# 用法: install-update.sh <zip路径> <当前.app路径> <等待退出的pid> [SKIP_LAUNCH]
# 由主进程 detached  spawn；等应用退出后解包、替换 bundle、拉起新版。旧版保留为 <app>.old-<ts> 供回滚。
set -u
ZIP="$1"
APP="$2"
WAIT_PID="$3"
SKIP_LAUNCH="${4:-}"

LOG_DIR="$HOME/Library/Logs/yandu-updater"
mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/install.log" 2>&1
echo "== $(date +%FT%T) start zip=$ZIP app=$APP waitpid=$WAIT_PID skip=${SKIP_LAUNCH:-0}"

# 等应用进程退出（最多 120s）；解包/替换必须在应用退出后进行，否则文件占用与半态
for _ in $(seq 1 120); do
  kill -0 "$WAIT_PID" 2>/dev/null || break
  sleep 1
done
if kill -0 "$WAIT_PID" 2>/dev/null; then
  echo "ABORT: app pid $WAIT_PID still running after 120s"
  exit 2
fi

[ -f "$ZIP" ] || { echo "ABORT: zip missing: $ZIP"; exit 3; }

TMP="$(mktemp -d /tmp/yandu-update.XXXXXX)" || { echo "ABORT: mktemp failed"; exit 4; }
if ! ditto -x -k "$ZIP" "$TMP"; then
  echo "ABORT: ditto extract failed"
  rm -rf "$TMP"
  exit 5
fi
NEW="$(find "$TMP" -maxdepth 1 -name '*.app' -print -quit)"
if [ -z "$NEW" ] || [ ! -d "$NEW/Contents/MacOS" ]; then
  echo "ABORT: no valid .app in zip"
  rm -rf "$TMP"
  exit 6
fi

BAK="${APP}.old-$(date +%Y%m%d-%H%M%S)"
if ! mv "$APP" "$BAK"; then
  echo "ABORT: backup move failed"
  rm -rf "$TMP"
  exit 7
fi
if ! mv "$NEW" "$APP"; then
  echo "RESTORE: new app move failed, restoring backup"
  mv "$BAK" "$APP"
  rm -rf "$TMP"
  exit 8
fi
rm -rf "$TMP"
echo "OK: installed $APP ; backup at $BAK"
if [ -z "$SKIP_LAUNCH" ]; then
  open "$APP" || echo "WARN: open failed, user can launch manually"
fi
exit 0
