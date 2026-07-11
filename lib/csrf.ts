// Lecture LiveOps — CSRF token (double-submit cookie pattern, P1-3)
// Edge runtime (middleware) 호환 — Web Crypto API만 사용.
// (Next 미들웨어는 Edge runtime이라 Node 전용 crypto 모듈을 import 할 수 없다.)

export const CSRF_COOKIE = 'liveops_csrf'
export const CSRF_HEADER = 'x-csrf-token'
export const CSRF_MAX_AGE_SEC = 86400 // 24h

// CSRF 검증을 면제하는 경로. 최소화 원칙.
export const CSRF_EXEMPT_PATHS = new Set<string>([
  '/api/csrf',
  '/api/csp/report',
  '/api/health',
  '/api/p/enter'
])

// 전체 prefix 면제 (NextAuth는 자체 CSRF 보호 사용)
const CSRF_EXEMPT_PREFIXES = ['/api/auth/']

const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

export function generateCsrfToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  // base64url-ish encoding (URL-safe 64글자 알파벳)
  let out = ''
  for (let i = 0; i < buf.length; i++) out += ALPH[buf[i] & 63]
  // 추가 4글자 (총 36자) — 엔트로피 충분
  const extra = new Uint8Array(4)
  crypto.getRandomValues(extra)
  for (let i = 0; i < extra.length; i++) out += ALPH[extra[i] & 63]
  return out
}

// constant-time string compare — Edge runtime 호환 (XOR 누적)
export function constantTimeCompare(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function isExemptFromCsrf(pathname: string): boolean {
  if (CSRF_EXEMPT_PATHS.has(pathname)) return true
  return CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p))
}

// Set-Cookie 헤더 값
export function csrfCookieHeader(token: string, opts: { secure: boolean }): string {
  const parts = [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${CSRF_MAX_AGE_SEC}`
  ]
  if (opts.secure) parts.push('Secure')
  // HttpOnly 일부러 빠짐 — double-submit 패턴은 JS가 cookie 읽어 header에 부착해야 함
  return parts.join('; ')
}
