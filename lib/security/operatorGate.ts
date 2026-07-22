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
// /workshops = 숙의 운영자 화면(목록/생성/콘솔/설정/프로젝터). 서버컴포넌트가 adminContext 로 직접 읽으므로
// 미들웨어 게이트가 없으면 무인증 노출된다 (C1). 참가자 화면은 /p/* 로 분리되어 있어 영향 없음.
const PROTECTED_PREFIXES = ['/today', '/companies', '/courses', '/dates', '/settings', '/workshops']
const PROTECTED_API_PREFIX = '/api/data'
// 참가자 자체 세션 쿠키로 보호되는 읽기 경로는 operator 게이트에서 제외한다.
// /api/data/delib/participant-view 는 참가자 신원 쿠키를 자체 검증하므로 operator 키가 없어도 접근 가능해야 한다.
const EXEMPT_API_PREFIXES = ['/api/data/participant', '/api/data/delib/participant-view']
// 숙의 결과 리포트 내려받기는 원 발언·절차 증빙을 담으므로 운영자 전용으로 보호한다.
// (기존 강의 export 경로 /api/export/{markdown,html,xlsx,pdf} 는 영향 없음 — delib 만 격리.)
const PROTECTED_API_PATHS = new Set(['/api/timeline-sync', '/api/export/delib'])

export function isOperatorProtectedPath(pathname: string): boolean {
  if (PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true
  if (PROTECTED_API_PATHS.has(pathname)) return true
  if (pathname === PROTECTED_API_PREFIX || pathname.startsWith(PROTECTED_API_PREFIX + '/')) {
    return !EXEMPT_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
  }
  return false
}
