// 세션 아카이브 진입 — GET /api/archive-enter?key=...&next=...
// 마스터 비밀번호 일치 시 쿠키를 심고 next로 redirect. 비밀번호는 로그/응답에 출력하지 않는다.

import { NextRequest, NextResponse } from 'next/server'
import {
  ARCHIVE_COOKIE,
  archiveCookieOptions,
  archiveMasterKey,
  isArchiveGateEnabled
} from '@/lib/security/archiveGate'
import { constantTimeEquals } from '@/lib/security/operatorGate'

export const dynamic = 'force-dynamic'

const SAFE_NEXT = /^\/[a-zA-Z0-9/_-]*$/

export async function GET(request: NextRequest) {
  const url = request.nextUrl
  const key = url.searchParams.get('key') ?? ''
  const nextRaw = url.searchParams.get('next') ?? '/sessions'
  const next = SAFE_NEXT.test(nextRaw) ? nextRaw : '/sessions'

  if (!isArchiveGateEnabled() || !archiveMasterKey()) {
    const back = new URL('/archive-enter', url.origin)
    back.searchParams.set('error', 'configuration')
    back.searchParams.set('next', next)
    return NextResponse.redirect(back)
  }

  if (!key || !constantTimeEquals(key, archiveMasterKey())) {
    const back = new URL('/archive-enter', url.origin)
    back.searchParams.set('error', '1')
    back.searchParams.set('next', next)
    return NextResponse.redirect(back)
  }

  const res = NextResponse.redirect(new URL(next, url.origin))
  res.cookies.set(ARCHIVE_COOKIE, archiveMasterKey(), archiveCookieOptions())
  return res
}
