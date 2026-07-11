import { describe, it, expect, afterEach } from 'vitest'
import { isArchiveProtectedPath, verifyArchiveCookie, isArchiveGateEnabled } from '@/lib/security/archiveGate'

describe('archiveGate — 보호 경로', () => {
  it('개별 세션 상세와 하위 라우트를 보호한다', () => {
    expect(isArchiveProtectedPath('/sessions/abc123')).toBe(true)
    expect(isArchiveProtectedPath('/sessions/abc123/timeline')).toBe(true)
    expect(isArchiveProtectedPath('/sessions/abc123/export')).toBe(true)
  })

  it('목록·새 세션·언락 페이지는 열어 둔다', () => {
    expect(isArchiveProtectedPath('/sessions')).toBe(false)
    expect(isArchiveProtectedPath('/sessions/new')).toBe(false)
    expect(isArchiveProtectedPath('/archive-enter')).toBe(false)
    expect(isArchiveProtectedPath('/today')).toBe(false)
  })
})

describe('archiveGate — 쿠키 검증', () => {
  const prev = process.env.ARCHIVE_MASTER_PASSWORD
  afterEach(() => {
    if (prev === undefined) delete process.env.ARCHIVE_MASTER_PASSWORD
    else process.env.ARCHIVE_MASTER_PASSWORD = prev
  })

  it('env 미설정이면 개발에서 게이트 OFF', () => {
    delete process.env.ARCHIVE_MASTER_PASSWORD
    expect(isArchiveGateEnabled()).toBe(false)
    expect(verifyArchiveCookie(undefined)).toBe(true)
  })

  it('env 설정 시 일치하는 쿠키만 통과', () => {
    process.env.ARCHIVE_MASTER_PASSWORD = '1023'
    expect(isArchiveGateEnabled()).toBe(true)
    expect(verifyArchiveCookie('1023')).toBe(true)
    expect(verifyArchiveCookie('0000')).toBe(false)
    expect(verifyArchiveCookie(undefined)).toBe(false)
  })
})
