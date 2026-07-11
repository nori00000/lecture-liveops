#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if ! npm --prefix "$ROOT" run build; then
  echo 'FAIL[build]: npm run build failed'
  exit 1
fi
echo 'PASS[build]: production build succeeded'
