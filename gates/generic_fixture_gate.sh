#!/usr/bin/env bash
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
SEED="$ROOT/lib/db/fixture/seed.ts"
if [ ! -f "$SEED" ]; then
  echo 'FAIL[generic_fixture]: synthetic fixture seed missing'
  exit 1
fi
if ! grep -Eq '샘플 기관|Example Organization' "$SEED"; then
  echo 'FAIL[generic_fixture]: generic organization marker missing'
  exit 1
fi
REAL_ORG_PATTERN='강릉''아산|서울''아산|한양''대학교병원|LG''인화원|LG U\+'
if grep -Eiq "$REAL_ORG_PATTERN" "$SEED"; then
  echo 'FAIL[generic_fixture]: real organization remains in fixture'
  exit 1
fi
echo 'PASS[generic_fixture]: fixture data is explicitly synthetic'
