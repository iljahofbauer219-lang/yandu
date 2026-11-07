#!/bin/bash
# 唯一重启入口：清 dev+打包全部实例与 Singleton 残锁，干净环境起 dev 构建并自验新实例生效。
# 禁止 pkill -f "cross-border-sourcing-desktop"：该串只命中 Helper，会留主进程白屏僵尸。
set -u
cd "$(dirname "$0")/.."
PORT=47823

# 中文进程名 grep 受 locale 影响不可靠（实测同串 ps 可见但 grep 0 命中），
# 只用单字节 ASCII 特征匹配；杀完必须复查端口持有者兜底。
pids=$( { ps -eo pid,args -ww | grep -E "node_modules/\.pnpm/electron[^ ]*/Electron\.app/Contents/MacOS/Electron \." ; \
          ps -eo pid,args -ww | grep -E "^[ ]*[0-9]+ /Users/[^ ]*\.app/Contents/MacOS/[^ ]*$" ; } | grep -v grep | awk '{print $1}' | sort -u | tr '\n' ' ')
if [ -n "${pids// /}" ]; then
  echo "[restart] 杀旧实例: $pids"
  kill $pids 2>/dev/null
  sleep 3
  kill -9 $pids 2>/dev/null || true
  sleep 1
fi

holder=$(lsof -nP -i :$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
if [ -n "$holder" ]; then
  hpath=$(ps -p "$holder" -o comm= 2>/dev/null || echo "")
  case "$hpath" in
    *"$PORT"*|*"Qoder"*|*"Xmind"*) echo "[restart] 失败：端口持有者非目标应用（$hpath），请人工确认" >&2; exit 1 ;;
  esac
  echo "[restart] 兜底杀端口持有者: $holder ($hpath)"
  kill "$holder" 2>/dev/null; sleep 3; kill -9 "$holder" 2>/dev/null || true; sleep 1
fi

# kill -9 后不清 Singleton 软链会静默 exit 0（台账 restart-app-white-screen-zombie）
rm -f "$HOME/Library/Application Support/cross-border-sourcing-desktop/Singleton"* 2>/dev/null || true

# ELECTRON_RUN_AS_NODE 会让 electron 降为纯 Node，主进程加载即 app undefined 崩溃
env -u ELECTRON_RUN_AS_NODE nohup npm start > /tmp/yandu-dev-start.log 2>&1 &

pid=""
for _ in $(seq 1 30); do
  sleep 2
  pid=$(lsof -nP -i :$PORT -sTCP:LISTEN -t 2>/dev/null | head -1)
  [ -n "$pid" ] && break
done
if [ -z "$pid" ]; then
  echo "[restart] 失败：无进程持有端口 $PORT；日志尾部：" >&2
  tail -6 /tmp/yandu-dev-start.log >&2
  exit 1
fi

lstart=$(ps -o lstart= -p "$pid" | tr -s ' ')
mt=$(stat -f '%m' dist/main/main/main.js)
st=$(date -j -f '%a %b %d %H:%M:%S %Y' "$(echo "$lstart" | tr -s ' ')" +%s 2>/dev/null || echo 0)
if [ "$st" -le "$mt" ]; then
  echo "[restart] 失败：进程启动时间不早于构建产物（仍旧实例？）lstart=$lstart" >&2
  exit 1
fi

sleep 5 # 窗口揭示标记晚于端口监听数秒，避免误报
grep -q "main window revealed" /tmp/yandu-dev-start.log || echo "[restart] 警告：尚未见窗口揭示标记，请查看 /tmp/yandu-dev-start.log" >&2

# bootloader 优先加载 ~/yandu-hot 外置构建，dist 比它新并不会被加载；只看进程启动时间会放行
# 四天前同步过的陈旧热更新（改完代码实机跑的仍是旧主进程）。这里核对「实际加载的构建」= 本次构建。
stamp=$(node -e "try{process.stdout.write(String(JSON.parse(require('node:fs').readFileSync('dist/build-stamp.json','utf8')).builtAt))}catch{process.stdout.write('')}")
loaded=$(grep -E "\[hot\] (external build loaded|builtin build loaded)" /tmp/yandu-dev-start.log | tail -1)
if [ -z "$loaded" ]; then
  echo "[restart] 失败：日志没有 [hot] 构建加载标记，无法确认主进程来源" >&2; exit 1
fi
case "$loaded" in
  *"builtin build loaded"*)
    echo "[restart] 主进程加载内置构建（hot 目录不存在或已 disabled），dist 即最新" ;;
  *)
    hot_built=$(printf '%s' "$loaded" | sed 's/.*builtAt //; s/).*$//')
    if [ -z "$stamp" ]; then
      echo "[restart] 失败：dist/build-stamp.json 读不到构建戳，无法核对热更新构建" >&2; exit 1
    fi
    if [ "$hot_built" != "$stamp" ]; then
      echo "[restart] 失败：实机加载的是热更新旧构建 builtAt=$hot_built，本次构建是 $stamp；先跑 npm run hot:sync 再重启" >&2
      exit 1
    fi ;;
esac
echo "[restart] OK pid=$pid lstart=$lstart"
[ -f dist/build-stamp.json ] && cat dist/build-stamp.json || echo "[restart] 警告：dist/build-stamp.json 缺失（构建链未跑写戳步）" >&2
