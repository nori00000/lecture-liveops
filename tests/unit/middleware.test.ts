import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'

// CI 는 LIVEOPS_RATE_LIMIT_DISABLE=1 로 띄움 (simulation step 위해). 단위 테스트는 rate limit 동작 검증 필요 → unset.
const ORIG_RATE_LIMIT_DISABLE = process.env.LIVEOPS_RATE_LIMIT_DISABLE
beforeAll(() => { delete process.env.LIVEOPS_RATE_LIMIT_DISABLE })
afterAll(() => { if (ORIG_RATE_LIMIT_DISABLE !== undefined) process.env.LIVEOPS_RATE_LIMIT_DISABLE = ORIG_RATE_LIMIT_DISABLE })
import { middleware } from '@/middleware'
import { resetRateLimitForTest, checkRateLimit } from '@/lib/rateLimit'
import { SECURITY_HEADERS, isAllowedOrigin } from '@/lib/security/headers'
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from '@/lib/csrf'

// CSRF 토큰을 자동으로 부여하는 helper. P1-3 도입 후 mutating POST에 필수.
function makeReq(
  url: string,
  init: { method?: string; headers?: Record<string, string>; cookie?: string; withCsrf?: boolean; body?: BodyInit } = {}
): NextRequest {
  const headers = new Headers(init.headers ?? {})
  const method = (init.method ?? 'GET').toUpperCase()
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  let cookie = init.cookie ?? ''
  if (isMutating && init.withCsrf !== false) {
    const token = generateCsrfToken()
    headers.set(CSRF_HEADER, token)
    cookie = cookie ? `${cookie}; ${CSRF_COOKIE}=${token}` : `${CSRF_COOKIE}=${token}`
  }
  if (cookie) headers.set('cookie', cookie)
  return new NextRequest(new URL(url), { method, headers, body: init.body })
}

function participantCookie(participantId: string): string {
  const payload = Buffer.from(JSON.stringify({
    accessKeyId: `ak-${participantId}`,
    sessionId: 'se-rate-limit',
    role: 'participant',
    exp: Date.now() + 60_000,
    participantId
  }), 'utf8').toString('base64url')
  return `liveops_participant_session=${payload}.test-signature`
}

describe('middleware — security headers', () => {
  beforeEach(() => resetRateLimitForTest())

  it('GET / 응답에 5종 보안 헤더 포함', async () => {
    const req = makeReq('http://localhost:3010/today')
    const res = await middleware(req)
    expect(res.headers.get('Content-Security-Policy-Report-Only')).toBeTruthy()
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=63072000')
    expect(res.headers.get('X-Frame-Options')).toBe('DENY')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(res.headers.get('Permissions-Policy')).toContain('camera=()')
  })

  it('CSP report-uri는 /api/csp/report로 설정', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy-Report-Only']).toContain('report-uri /api/csp/report')
  })
})

describe('middleware — rate limit', () => {
  beforeEach(() => resetRateLimitForTest())

  it('POST 30번까지 통과, 31번째 429', async () => {
    let last = 0
    for (let i = 1; i <= 31; i++) {
      const req = makeReq('http://localhost:3010/api/action', {
        method: 'POST',
        headers: { origin: 'http://localhost:3010', 'x-forwarded-for': '10.0.0.1' }
      })
      const res = await middleware(req)
      last = res.status
    }
    expect(last).toBe(429)
  })

  it('같은 IP의 참가자 액션은 participant session subject별로 분리된다', async () => {
    let last = 0
    for (let i = 1; i <= 31; i++) {
      const req = makeReq('http://localhost:3010/api/action', {
        method: 'POST',
        cookie: participantCookie(`pt-${i}`),
        headers: {
          origin: 'http://localhost:3010',
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.9'
        },
        body: JSON.stringify({ action: 'delib.vote_statement', actor: { role: 'participant' } })
      })
      last = (await middleware(req)).status
    }
    expect(last).toBe(200)
  })

  it('같은 participant session subject는 인증 한도 이후 429', async () => {
    let last = 0
    for (let i = 1; i <= 61; i++) {
      const req = makeReq('http://localhost:3010/api/action', {
        method: 'POST',
        cookie: participantCookie('pt-one'),
        headers: {
          origin: 'http://localhost:3010',
          'content-type': 'application/json',
          'x-forwarded-for': '10.0.0.10'
        },
        body: JSON.stringify({ action: 'delib.vote_statement', actor: { role: 'participant' } })
      })
      last = (await middleware(req)).status
    }
    expect(last).toBe(429)
  })

  it('/api/health POST는 rate limit 제외', async () => {
    let last = 0
    for (let i = 1; i <= 100; i++) {
      const req = makeReq('http://localhost:3010/api/health', {
        method: 'POST',
        headers: { origin: 'http://localhost:3010', 'x-forwarded-for': '10.0.0.2' }
      })
      const res = await middleware(req)
      last = res.status
    }
    // 200 (next pass-through) — middleware는 200 status로 NextResponse.next() 반환
    expect(last).toBe(200)
  })

  it('GET은 rate limit 미적용 (immutable method)', async () => {
    let last = 0
    for (let i = 1; i <= 100; i++) {
      const req = makeReq('http://localhost:3010/today', {
        headers: { 'x-forwarded-for': '10.0.0.3' }
      })
      last = (await middleware(req)).status
    }
    expect(last).toBe(200)
  })
})

describe('middleware — origin check', () => {
  beforeEach(() => resetRateLimitForTest())

  it('외부 origin POST → 403', async () => {
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', 'x-forwarded-for': '10.0.0.4' }
    })
    const res = await middleware(req)
    expect(res.status).toBe(403)
  })

  it('같은 origin POST → 200 (next pass-through)', async () => {
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      headers: { origin: 'http://localhost:3010', 'x-forwarded-for': '10.0.0.5' }
    })
    const res = await middleware(req)
    expect(res.status).toBe(200)
  })

  it('isAllowedOrigin: explicit configured origin + localhost only', () => {
    const previous = process.env.NEXT_PUBLIC_ORIGIN
    process.env.NEXT_PUBLIC_ORIGIN = 'https://liveops.example.com'
    expect(isAllowedOrigin('http://localhost:3010')).toBe(true)
    expect(isAllowedOrigin('https://liveops.example.com')).toBe(true)
    expect(isAllowedOrigin('https://lecture-liveops.vercel.app')).toBe(false)
    expect(isAllowedOrigin('https://evil.example.com')).toBe(false)
    expect(isAllowedOrigin('')).toBe(false)
    expect(isAllowedOrigin(null)).toBe(false)
    if (previous === undefined) delete process.env.NEXT_PUBLIC_ORIGIN
    else process.env.NEXT_PUBLIC_ORIGIN = previous
  })

  it('origin 없는 POST는 server API key 없으면 거부', async () => {
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      withCsrf: false,
      headers: { 'x-forwarded-for': '10.0.0.6' }
    })
    expect((await middleware(req)).status).toBe(403)
  })

  it('origin 없는 POST는 올바른 server API key로 통과', async () => {
    const previous = process.env.LIVEOPS_SERVER_API_KEY
    process.env.LIVEOPS_SERVER_API_KEY = 'server-test-key'
    const req = makeReq('http://localhost:3010/api/action', {
      method: 'POST',
      withCsrf: false,
      headers: { 'x-liveops-api-key': 'server-test-key', 'x-forwarded-for': '10.0.0.7' }
    })
    expect((await middleware(req)).status).toBe(200)
    if (previous === undefined) delete process.env.LIVEOPS_SERVER_API_KEY
    else process.env.LIVEOPS_SERVER_API_KEY = previous
  })
})

describe('rateLimit core', () => {
  beforeEach(() => resetRateLimitForTest())

  it('첫 호출은 limited=false', () => {
    const r = checkRateLimit('1.1.1.1', '/api/action')
    expect(r.limited).toBe(false)
    expect(r.count).toBe(1)
    expect(r.limit).toBe(30)
  })

  it('/api/admin/* 경로는 limit 60', () => {
    const r = checkRateLimit('1.1.1.2', '/api/admin/users')
    expect(r.limit).toBe(60)
  })

  it('register_participant는 bulk operator 정책으로 높은 한도를 쓴다', () => {
    const r = checkRateLimit('operator:test', '/api/action', { authenticated: true, action: 'delib.register_participant' })
    expect(r.limit).toBe(300)
  })

  it('30번 누적 → 31번째 limited=true', () => {
    let last = checkRateLimit('1.1.1.3', '/api/action')
    for (let i = 0; i < 30; i++) last = checkRateLimit('1.1.1.3', '/api/action')
    expect(last.limited).toBe(true)
    expect(last.count).toBeGreaterThan(30)
  })
})
