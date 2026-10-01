#!/bin/bash
# 服务器恢复后体检（只读诊断，不做任何变更）：ssh 登入查磁盘/负载/nginx/容器/loopback API。
# 用法：bash tools/server-health-check.sh
set -u
HOST="root@114.55.149.192"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" '
  echo "== df"; df -h / /var | tail -2
  echo "== uptime"; uptime
  echo "== nginx"; systemctl is-active nginx || true
  echo "== containers"; docker ps --format "{{.Names}}\t{{.Status}}" | head -8
  echo "== loopback api"; curl -s -m 5 -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/api/auth/me || true
' || { echo "ABORT: ssh 仍不可达（banner 挂死=宿主机未恢复）"; exit 1; }
