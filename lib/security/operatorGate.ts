// Lecture LiveOps — operator access key gate
// Local fixture development may run without a key. Production is always fail-closed.

export const OPERATOR_COOKIE = 'liveops_operator_session'

export function operatorKey(): string {
  return process.env.LIVEOPS_OPERATOR_KEY ?? ''
}

export function isOperatorGateRequired(): boolean {
  return process.env.NODE_ENV === 'production' || operatorKey().length > 0
}

export function isOperatorGateEnabled(): boolean {
  return isOperatorGateRequired()
}

// 길이 노출을 피하기 위해 길이 불일치도 동일 비용 경로로 처리한다.
export function constantTimeEquals(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length, 1)
  let diff = a.length === b.length ? 0 : 1
  for (let i = 0; i < max; i += 1) {
    diff |= (a.charCodeAt(i % Math.max(a.length, 1)) || 0) ^ (b.charCodeAt(i % Math.max(b.length, 1)) || 0)
  }
  return diff === 0 && a.length === b.length
}

export function verifyOperatorCookie(value: string | undefined | null): boolean {
  const key = operatorKey()
  if (!isOperatorGateRequired()) return true
  if (!key || !value) return false
  return constantTimeEquals(value, key)
}

export function operatorCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 // 7일 — 교육 주간 커버
  }
}

// 게이트 보호 대상 prefix. /api/data/participant는 참가자 세션이 자체 보호.
const PROTECTED_PREFIXES = ['/today', '/companies', '/courses', '/dates', '/settings']
const PROTECTED_API_PREFIX = '/api/data'
const EXEMPT_API_PREFIXES = ['/api/data/participant']
const PROTECTED_API_PATHS = new Set(['/api/timeline-sync'])

export function isOperatorProtectedPath(pathname: string): boolean {
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true
  if (PROTECTED_API_PATHS.has(pathname)) return true
  if (pathname === PROTECTED_API_PREFIX || pathname.startsWith(PROTECTED_API_PREFIX + '/')) {
    return !EXEMPT_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  }
  return false
}
