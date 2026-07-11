#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
for path in _workspace archives recordings transcripts rosters runtime-data local-state .env .env.local .vercel; do
  if git ls-files --error-unmatch "$path" >/dev/null 2>&1 || git ls-files "$path/**" | grep -q .; then
    echo "FAIL[public_tree]: forbidden tracked path $path"
    exit 1
  fi
done
if git ls-files | grep -E '(^|/)([^/]*\.log|[^/]*\.(sqlite|db|pem|key|p12))$' >/dev/null; then
  echo 'FAIL[public_tree]: runtime, database, or credential artifact tracked'
  exit 1
fi
if [ ! -f .env.example ]; then
  echo 'FAIL[public_tree]: .env.example missing'
  exit 1
fi
echo 'PASS[public_tree]: tracked tree excludes runtime and operations data'
