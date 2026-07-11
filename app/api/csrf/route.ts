import { NextResponse } from 'next/server'
import { CSRF_COOKIE, csrfCookieHeader, generateCsrfToken } from '@/lib/csrf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET → 새 토큰 발급. Set-Cookie + body에 동일 토큰.
// 클라이언트는 페이지 로드 시 1회 호출하여 캐싱.
export async function GET(req: Request) {
  // 기존 cookie가 있어도 새 토큰으로 갱신 (rotation)
  const token = generateCsrfToken()
  const isSecure = new URL(req.url).protocol === 'https:'
  const res = NextResponse.json(
    { token, cookieName: CSRF_COOKIE },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
  res.headers.append('Set-Cookie', csrfCookieHeader(token, { secure: isSecure }))
  return res
}
