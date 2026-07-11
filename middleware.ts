// Lecture LiveOps — global middleware (P1-2 + P1-3)
// 순서: origin check → CSRF token check → rate limit → 보안 헤더 주입.
// CSRF는 double-submit cookie 패턴 (cookie + header 일치).
// 면제: /api/csrf (토큰 발급), /api/csp/report (브라우저 자동), /api/health.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SECURITY_HEADERS, isAllowedOrigin, isExemptFromRateLimit, isExemptFromOriginCheck } from '@/lib/security/headers'
import { checkRateLimit } from '@/lib/rateLimit'
import { CSRF_COOKIE, CSRF_HEADER, constantTimeCompare, isExemptFromCsrf } from '@/lib/csrf'
import {
  OPERATOR_COOKIE,
  isOperatorGateEnabled,
  isOperatorProtectedPath,
  verifyOperatorCookie
} from '@/lib/security/operatorGate'
import {
  ARCHIVE_COOKIE,
  isArchiveGateEnabled,
  isArchiveProtectedPath,
  verifyArchiveCookie
} from '@/lib/security/archiveGate'

// P1-6: request id 생성 (응답 헤더 + 다운스트림 핸들러에 전달)
function newRequestId(): string {
  // Edge runtime: crypto.randomUUID() 사용 가능
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  return c?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)']
}

function applyHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v)
  return res
}

function jsonError(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}): NextResponse {
  const res = NextResponse.json(body, { status, headers: extraHeaders })
  applyHeaders(res)
  return res
}

function hasServerApiKey(req: NextRequest): boolean {
  const expected = process.env.LIVEOPS_SERVER_API_KEY ?? ''
  const provided = req.headers.get('x-liveops-api-key') ?? ''
  return expected.length > 0 && constantTimeCompare(expected, provided)
}

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl
  const method = req.method.toUpperCase()
  const isMutating = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'

  // P1-6: 모든 요청에 request id (header 우선, 없으면 신규)
  const requestId = req.headers.get('x-request-id') ?? newRequestId()

  // operator access key 게이트 — LIVEOPS_OPERATOR_KEY 설정 시에만 활성 (operatorGate.ts).
  // 보호: /today, /api/data(참가자 경로 제외), 관리 페이지. /enter·/p·/share·/admin 등은 미보호 경로.
  if (isOperatorGateEnabled() && isOperatorProtectedPath(pathname)) {
    const cookie = req.cookies.get(OPERATOR_COOKIE)?.value
    if (!verifyOperatorCookie(cookie)) {
      if (pathname.startsWith('/api/')) {
        return jsonError(401, { error: 'operator_key_required' })
      }
      const url = req.nextUrl.clone()
      url.pathname = '/enter'
      url.search = `?next=${encodeURIComponent(pathname)}`
      return applyHeaders(NextResponse.redirect(url))
    }
  }

  // 세션 아카이브 비밀번호 게이트 — ARCHIVE_MASTER_PASSWORD 설정 시에만 활성 (archiveGate.ts).
  // 보호: /sessions 섹션 전체. 언락 페이지(/archive-enter)는 /sessions 밖이라 자연 제외.
  if (isArchiveGateEnabled() && isArchiveProtectedPath(pathname)) {
    const cookie = req.cookies.get(ARCHIVE_COOKIE)?.value
    if (!verifyArchiveCookie(cookie)) {
      const url = req.nextUrl.clone()
      url.pathname = '/archive-enter'
      url.search = `?next=${encodeURIComponent(pathname)}`
      return applyHeaders(NextResponse.redirect(url))
    }
  }

  // origin check: browser mutations require an allowed origin. Server-to-server
  // mutations require a separate API key and never inherit browser cookies.
  const origin = req.headers.get('origin')
  const serverAuthenticated = isMutating && !origin && hasServerApiKey(req)
  if (isMutating && !isExemptFromOriginCheck(pathname)) {
    if (!origin && !serverAuthenticated) {
      return jsonError(403, { error: 'forbidden_origin', reason: 'missing_origin_or_server_key' })
    }
    if (origin && !isAllowedOrigin(origin)) {
      return jsonError(403, { error: 'forbidden_origin', origin })
    }
  }

  // Browser mutations use a double-submit CSRF token. Authenticated server calls
  // do not carry browser cookies and are authenticated with LIVEOPS_SERVER_API_KEY.
  if (isMutating && !isExemptFromCsrf(pathname) && !serverAuthenticated) {
    const cookieToken = req.cookies.get(CSRF_COOKIE)?.value
    const headerToken = req.headers.get(CSRF_HEADER)
    if (!constantTimeCompare(cookieToken ?? '', headerToken ?? '')) {
      return jsonError(403, {
        error: 'csrf_invalid',
        reason: !cookieToken ? 'missing_cookie' : !headerToken ? 'missing_header' : 'mismatch'
      })
    }
  }

  // rate limit (mutating + 비제외 경로만)
  // CI/test/simulation 등 부하 검증이 아닌 기능 검증 환경은 LIVEOPS_RATE_LIMIT_DISABLE=1 로 skip.
  const rateLimitDisabled = process.env.LIVEOPS_RATE_LIMIT_DISABLE === '1'
  if (isMutating && !isExemptFromRateLimit(pathname) && !rateLimitDisabled) {
    const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '0.0.0.0'
    const ip = fwd.split(',')[0].trim() || '0.0.0.0'
    const r = checkRateLimit(ip, pathname)
    if (r.limited) {
      return jsonError(
        429,
        { error: 'rate_limited', count: r.count, limit: r.limit, retry_after: r.retryAfterSec },
        { 'Retry-After': String(r.retryAfterSec), 'X-RateLimit-Limit': String(r.limit), 'X-RateLimit-Remaining': '0' }
      )
    }
  }

  // 모든 통과 요청에 X-Request-Id 헤더 + downstream 헤더에도 주입
  const reqHeaders = new Headers(req.headers)
  reqHeaders.set('x-request-id', requestId)
  const res = NextResponse.next({ request: { headers: reqHeaders } })
  res.headers.set('x-request-id', requestId)
  return applyHeaders(res)
}
