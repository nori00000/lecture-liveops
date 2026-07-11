import { describe, expect, it, vi } from 'vitest'
import {
  PARTICIPANT_SESSION_COOKIE,
  PARTICIPANT_SESSION_MAX_AGE_SEC,
  createParticipantSession,
  participantCookieOptions,
  readParticipantSession
} from '@/lib/participantSession'
import type { AccessKey } from '@/lib/db/schema'

const key: AccessKey = {
  id: 'ak-test',
  session_id: 'se-001',
  role: 'participant',
  key_hash: 'demo-hash-test',
  expires_at: '2099-01-01T00:00:00.000Z',
  revoked_at: null,
  scope: {}
}

describe('participant session cookie', () => {
  it('access key metadata를 서명된 세션으로 round-trip한다', () => {
    const token = createParticipantSession(key, Date.UTC(2026, 0, 1))
    const parsed = readParticipantSession(token, Date.UTC(2026, 0, 1))
    expect(parsed).toMatchObject({ accessKeyId: 'ak-test', sessionId: 'se-001', role: 'participant' })
  })

  it('signature 변조를 거부한다', () => {
    const token = createParticipantSession(key)
    expect(readParticipantSession(token.replace(/.$/, 'x'))).toBeNull()
  })

  it('만료 세션을 거부한다', () => {
    const token = createParticipantSession({ ...key, expires_at: '2026-01-01T00:00:00.000Z' }, Date.UTC(2025, 0, 1))
    expect(readParticipantSession(token, Date.UTC(2026, 0, 2))).toBeNull()
  })

  it('cookie option은 httpOnly + sameSite=lax + 루트 path(/)를 사용한다', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const opts = participantCookieOptions()
    expect(PARTICIPANT_SESSION_COOKIE).toBe('liveops_participant_session')
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    // '/p'로 좁히면 /api/action·/api/p/*에 쿠키가 전송되지 않아 participant invoke가 403이 된다.
    expect(opts.path).toBe('/')
    expect(opts.maxAge).toBe(PARTICIPANT_SESSION_MAX_AGE_SEC)
    vi.unstubAllEnvs()
  })
})
