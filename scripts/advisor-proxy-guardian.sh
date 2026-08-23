#!/bin/zsh
set -u

parent_pid="$1"
proxy_binary="$2"

cleanup() {
  "${proxy_binary}" stop >/dev/null 2>&1 || true
  exit 0
}

trap cleanup TERM INT HUP

"${proxy_binary}" start --port 10101 >/dev/null 2>&1 &
proxy_pid="$!"

while /bin/kill -0 "${parent_pid}" 2>/dev/null; do
  if ! /bin/kill -0 "${proxy_pid}" 2>/dev/null; then
    wait "${proxy_pid}"
    exit "$?"
  fi
  sleep 1
done

cleanup
