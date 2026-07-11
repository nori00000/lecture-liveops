#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if ! npm --prefix "$ROOT" test; then
  echo 'FAIL[test]: test suite failed'
  exit 1
fi
if ! npm --prefix "$ROOT" run typecheck; then
  echo 'FAIL[test]: typecheck failed'
  exit 1
fi
if ! npm --prefix "$ROOT" run lint; then
  echo 'FAIL[test]: lint failed'
  exit 1
fi
echo 'PASS[test]: tests, typecheck, and lint succeeded'
