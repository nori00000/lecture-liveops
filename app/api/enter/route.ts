// operator access key 진입 — GET /api/enter?key=...&next=...
// 키 일치 시 쿠키를 심고 next로 redirect (북마크 1탭 진입용).
// 키 값은 어떤 로그/응답 본문에도 출력하지 않는다.

import { NextRequest, NextResponse } from 'next/server'
import {
  OPERATOR_COOKIE,
  constantTimeEquals,
  isOperatorGateEnabled,
  operatorCookieOptions,
  operatorKey
} from '@/lib/security/operatorGate'

export const dynamic = 'force-dynamic'

const SAFE_NEXT = /^\/[a-zA-Z0-9/_-]*$/

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const key = url.searchParams.get('key') ?? ''
  const nextRaw = url.searchParams.get('next') ?? '/today/seatmap'
  const next = SAFE_NEXT.test(nextRaw) ? nextRaw : '/today/seatmap'

  if (!isOperatorGateEnabled() || !operatorKey()) {
    const back = new URL('/enter', url.origin)
    back.searchParams.set('error', 'configuration')
    back.searchParams.set('next', next)
    return NextResponse.redirect(back)
  }

  if (!key || !constantTimeEquals(key, operatorKey())) {
    const back = new URL('/enter', url.origin)
    back.searchParams.set('error', '1')
    back.searchParams.set('next', next)
    return NextResponse.redirect(back)
  }

  const res = NextResponse.redirect(new URL(next, url.origin))
  res.cookies.set(OPERATOR_COOKIE, operatorKey(), operatorCookieOptions())
  return res
}
