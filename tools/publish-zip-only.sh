#!/bin/bash
#  flapping 服务器下的最小发布：仅传 mac zip + latest-mac.yml（自动更新最小集），dmg 另行补传。
#  顺序保证：先 zip 后 yml（客户端读到 yml 时 zip 必须已就位）。
set -euo pipefail
cd "$(dirname "$0")/.."
HOST="root@114.55.149.192"
V="$(node -p "require('./package.json').version")"
ZIP="YanduCrossBorder-${V}-x64.zip"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"
SCP="scp -o BatchMode=yes"

$SSH $HOST "mkdir -p /tmp/rel-${V}"
$SCP "release/${ZIP}" release/latest-mac.yml "${HOST}:/tmp/rel-${V}/"
$SSH $HOST "ossutil cp -f --acl public-read /tmp/rel-${V}/${ZIP} oss://yandu-download/${ZIP} && ossutil cp -f --acl public-read /tmp/rel-${V}/latest-mac.yml oss://yandu-download/latest-mac.yml"
LIVE="$(curl -s --max-time 10 https://yandu-download.oss-cn-hangzhou.aliyuncs.com/latest-mac.yml | head -1 | awk '{print $2}')"
echo "[verify] feed=${LIVE} expect=${V}"
[ "$LIVE" = "$V" ] || { echo "ABORT: feed 回读不一致"; exit 1; }
echo "[done] zip+yml 发布完成；dmg 待补传（tools/publish-dmg-later.sh 或手工 scp+ossutil）"
