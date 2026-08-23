#!/bin/sh
set -eu

: "${DEEPSEEK_API_KEY:?DEEPSEEK_API_KEY must be set}"
: "${DSH_PUBLIC_HOST:?DSH_PUBLIC_HOST must be set}"

mkdir -p /workspace /state
cd /workspace

# Keep the built-in DeepSeek route editable from the Models page. The launch
# environment remains a one-time bootstrap source only; subsequent changes are
# written by the web UI to the local credential store and are not overwritten.
if ! grep -q '^llm-deepseek:' /state/settings.yaml 2>/dev/null; then
  printf '%s\n' 'llm-deepseek:' '  apiKeyEnv: DEEPSEEK_API_KEY_UI' >> /state/settings.yaml
fi
# This deployment stores a YAML mapping (despite the legacy .yaml filename).
# Seed the editable credential inside that mapping rather than appending a
# second document, which would make the credentials loader reject the file.
if [ ! -f /state/.credentials.yaml ]; then
  printf '%s\n' '{}' > /state/.credentials.yaml
fi
if ! grep -q '^  DEEPSEEK_API_KEY_UI:' /state/.credentials.yaml 2>/dev/null; then
  sed -i '$d' /state/.credentials.yaml
  printf '  DEEPSEEK_API_KEY_UI: %s\n}\n' "$DEEPSEEK_API_KEY" >> /state/.credentials.yaml
fi
chmod 600 /state/.credentials.yaml

# The official web host stays loopback-only. The Node proxy is the sole private-network
# bridge; the outer gateway preserves the public Host header trusted below.
node --expose-internals /opt/deepseek-harness/apps/cli/lib/bin.js web \
  --host 127.0.0.1 \
  --port 3080 \
  --trusted-host "$DSH_PUBLIC_HOST" &
harness_pid=$!

cleanup() {
  kill "$harness_pid" 2>/dev/null || true
  wait "$harness_pid" 2>/dev/null || true
}
trap cleanup INT TERM EXIT

node /usr/local/lib/deepseek-harness-proxy.mjs &
proxy_pid=$!
wait "$harness_pid"
kill "$proxy_pid" 2>/dev/null || true
