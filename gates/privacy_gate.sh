#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
PATTERN='(/Users/|/home/[A-Za-z0-9._-]+/|voidlight-avatar|icthyeon)'
if grep -RInE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=_workspace --exclude='privacy_gate.sh' "$PATTERN" "$ROOT" >/tmp/lecture-liveops-privacy-hits.txt 2>/dev/null; then
  echo 'FAIL[privacy]: personal or organization identifiers detected'
  perl -ne 'print if $. <= 20' /tmp/lecture-liveops-privacy-hits.txt
  exit 1
fi
echo 'PASS[privacy]: no personal paths or real-operation identifiers'
