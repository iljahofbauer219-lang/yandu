#!/usr/bin/env bash
set -euo pipefail

workspace_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
harness_dir="$workspace_dir/vendor/deepseek-harness"

if [[ ! -f "$harness_dir/package.json" || ! -f "$harness_dir/pnpm-lock.yaml" ]]; then
  echo "DeepSeek Harness source is missing from $harness_dir" >&2
  exit 1
fi

for command_name in node npm pnpm; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 19) || major >= 24 ? 0 : 1)' \
  || { echo "DeepSeek Harness requires Node.js ^22.19.0 or >=24.0.0" >&2; exit 1; }

cd "$harness_dir"
pnpm install --frozen-lockfile

# This repository nests Harness below an existing React 19 application. Ensure
# TypeScript resolves Harness's pinned React 18 peer types before walking to
# the parent workspace's node_modules directory.
for package_name in react react-dom; do
  if [[ ! -e "node_modules/$package_name" && -e "node_modules/.pnpm/node_modules/$package_name" ]]; then
    ln -s ".pnpm/node_modules/$package_name" "node_modules/$package_name"
  fi
done
for type_package in react react-dom; do
  if [[ ! -e "node_modules/@types/$type_package" && -e "node_modules/.pnpm/node_modules/@types/$type_package" ]]; then
    ln -s "../.pnpm/node_modules/@types/$type_package" "node_modules/@types/$type_package"
  fi
done

npm run build
