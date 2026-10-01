#!/bin/bash
# 服务器恢复日一键收尾（⑥）：体检 → 按需恢复 Web → 发布 v1.0.18 → 回读 feed → https 复核。
# 前置：服务器 ssh 已恢复（tools/server-health-check.sh 能出报告）。任一环节失败即中止并保留现场。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1. 体检"
bash tools/server-health-check.sh

echo "== 2. Web 服务复核（nginx 与 yandu-app 容器不健康则重启）"
ssh -o BatchMode=yes root@114.55.149.192 '
  if ! systemctl is-active --quiet nginx; then echo "[recover] restart nginx"; systemctl restart nginx; fi
  if ! docker ps --format "{{.Names}}" | grep -q "^yandu-app$"; then echo "[recover] start yandu-app"; cd /opt/yandu/app && docker compose up -d app || docker start yandu-app; fi
  sleep 3
  code=$(curl -s -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/api/auth/me || true)
  echo "[loopback] /api/auth/me -> $code"
  [ "$code" != "000" ] || { echo "ABORT: loopback API 仍不可达，先人工排查容器日志"; exit 1; }
'

echo "== 3. 发布（复用本地 release/ 产物，含签名重打 zip）"
node tools/publish-release.mjs --execute --platform=mac --skip-build

echo "== 4. 外网 https 复核"
code=$(curl -s -m 10 -o /dev/null -w "%{http_code}" -k https://114.55.149.192/api/auth/me || true)
echo "[https] /api/auth/me -> $code（401/200 均视为存活）"
[ "$code" != "000" ] || { echo "ABORT: 外网 https 仍不可达（nginx/防火墙层）"; exit 1; }
echo "== 完成：请用户在 App 内在线登录并目视二级复核链路（通过→正式入库待复核→复核确认→入库处理）"
