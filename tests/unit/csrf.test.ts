import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_EXEMPT_PATHS,
  generateCsrfToken,
  constantTimeCompare,
  isExemptFromCsrf,
  csrfCookieHeader
} from '@/lib/csrf'
import { middleware } from '@/middleware'
import { resetRateLimitForTest } from '@/lib/rateLimit'

function makeReq(url: string, init: { method?: string; headers?: Record<string, string>; cookie?: string } = {}): NextRequest {
  const headers = new Headers(init.headers ?? {})
  if (init.cookie) headers.set('cookie', init.cookie)
  return new NextRequest(new URL(url), { method: init.method ?? 'GET', headers })
}

describe('csrf core', () => {
  it('generateCsrfToken: 길이 ≥ 32, base64url 형식', () => {
    const a = generateCsrfToken()
    const b = generateCsrfToken()
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('constantTimeCompare: 동일/다름/길이 다름/null 처리', () => {
    expect(constantTimeCompare('abc', 'abc')).toBe(true)
    expect(constantTimeCompare('abc', 'abd')).toBe(false)
    expect(constantTimeCompare('abc', 'abcd')).toBe(false)
    expect(constantTimeCompare(null, 'x')).toBe(false)
    expect(constantTimeCompare('x', undefined)).toBe(false)
    expect(constantTimeCompare('', '')).toBe(false) // 빈 문자열도 reject
  })

  it('isExemptFromCsrf: /api/csrf, /api/csp/report, /api/health, /api/p/enter 면제', () => {
    expect(isExemptFromCsrf('/api/csrf')).toBe(true)
    expect(isExemptFromCsrf('/api/csp/report')).toBe(true)
    expect(isExemptFromCsrf('/api/health')).toBe(true)
    expect(isExemptFromCsrf('/api/p/enter')).toBe(true)
    expect(isExemptFromCsrf('/api/action')).toBe(false)
    expect(isExemptFromCsrf('/api/timeline-sync')).toBe(false)
    expect(CSRF_EXEMPT_PATHS.size).toBeLessThanOrEqual(6)
  })

  it('csrfCookieHeader: SameSite=Lax, Path=/, Max-Age, Secure 조건부, HttpOnly 없음', () => {
    const h = csrfCookieHeader('abc', { secure: true })
    expect(h).toContain('liveops_csrf=abc')
    expect(h).toContain('SameSite=Lax')
    expect(h).toContain('Path=/')
    expect(h).toContain('Max-Age=86400')
    expect(h).toContain('Secure')
    expect(h.toLowerCase()).not.toContain('httponly')

    const h2 = csrfCookieHeader('abc', { secure: false })
    expect(h2).not.toContain('Secure')
  })
})

describe('middleware csrf gate', () => {
  beforeEach(() => resetRateLimitForTest())

  it('토큰 없는 POST → 403 csrf_invalid (origin 헤더 있을 때)', () => {
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { origin: 'http://localhost:3010' }
    })
    const res = middleware(req)
    expect(res.status).toBe(403)
  })

  it('cookie/header 불일치 POST → 403', () => {
    const token = generateCsrfToken()
    const other = generateCsrfToken()
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { origin: 'http://localhost:3010', [CSRF_HEADER]: other },
      cookie: `${CSRF_COOKIE}=${token}`
    })
    const res = middleware(req)
    expect(res.status).toBe(403)
  })

  it('cookie/header 일치 POST → 통과 (200)', () => {
    const token = generateCsrfToken()
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { origin: 'http://localhost:3010', [CSRF_HEADER]: token },
      cookie: `${CSRF_COOKIE}=${token}`
    })
    const res = middleware(req)
    expect(res.status).toBe(200)
  })

  it('면제 경로 /api/csrf POST 토큰 없어도 통과', () => {
    const req = makeReq('http://localhost:3010/api/csrf', {
      method: 'POST',
      headers: { origin: 'http://localhost:3010' }
    })
    const res = middleware(req)
    expect(res.status).toBe(200)
  })

  it('origin 헤더 없는 POST는 server API key가 있어야 통과', () => {
    const previous = process.env.LIVEOPS_SERVER_API_KEY
    process.env.LIVEOPS_SERVER_API_KEY = 'server-test-key'
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { 'x-liveops-api-key': 'server-test-key' }
    })
    const res = middleware(req)
    expect(res.status).toBe(200)
    if (previous === undefined) delete process.env.LIVEOPS_SERVER_API_KEY
    else process.env.LIVEOPS_SERVER_API_KEY = previous
  })
})
