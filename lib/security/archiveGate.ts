// Lecture LiveOps — archived session access gate
// Local fixture development may run without a key. Production is always fail-closed.

import { constantTimeEquals } from './operatorGate'

export const ARCHIVE_COOKIE = 'liveops_archive_session'

export function archiveMasterKey(): string {
  return process.env.ARCHIVE_MASTER_PASSWORD ?? ''
}

export function isArchiveGateRequired(): boolean {
  return process.env.NODE_ENV === 'production' || archiveMasterKey().length > 0
}

export function isArchiveGateEnabled(): boolean {
  return isArchiveGateRequired()
}

export function verifyArchiveCookie(value: string | undefined | null): boolean {
  const key = archiveMasterKey()
  if (!isArchiveGateRequired()) return true
  if (!key || !value) return false
  return constantTimeEquals(value, key)
}

export function archiveCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 // 7일 — 교육 주간 커버
  }
}

// 개별 세션 상세(/sessions/<id> 및 하위)만 보호한다 — "각 세션마다 비밀번호".
// 목록(/sessions)과 새 세션 생성(/sessions/new)은 열어 둬 교육종료→새 세션 흐름을 막지 않는다.
// 언락 페이지(/archive-enter)는 /sessions 밖이라 자연히 제외된다.
export function isArchiveProtectedPath(pathname: string): boolean {
  if (!pathname.startsWith('/sessions/')) return false
  const first = pathname.slice('/sessions/'.length).split('/')[0]
  if (!first || first === 'new') return false
  return true
}
