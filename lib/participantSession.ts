import { createHmac, timingSafeEqual } from 'crypto'
import type { AccessKey, Role } from '@/lib/db/schema'

export const PARTICIPANT_SESSION_COOKIE = 'liveops_participant_session'
export const PARTICIPANT_SESSION_MAX_AGE_SEC = 60 * 60 * 12

export type ParticipantSession = {
  accessKeyId: string
  sessionId: string
  role: Role
  exp: number
  // 숙의 도메인 — 참가자 identity/그룹 배정. 하위호환: 없어도 파싱 성공.
  participantId?: string
  groupId?: string
}

function sessionSecret(): string {
  const secret = process.env.AX_SESSION_SECRET || process.env.AUTH_SECRET || 'lecture-liveops-local-session-secret'
  if (process.env.NODE_ENV === 'production' && secret.length < 32) throw new Error('AX_SESSION_SECRET must be at least 32 chars in production')
  return secret
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function unbase64url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(payload: string): string {
  return createHmac('sha256', sessionSecret()).update(payload).digest('base64url')
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function createParticipantSession(
  accessKey: AccessKey,
  now = Date.now(),
  identity: { participantId?: string; groupId?: string } = {}
): string {
  const exp = Math.min(now + PARTICIPANT_SESSION_MAX_AGE_SEC * 1000, new Date(accessKey.expires_at).getTime())
  const session: ParticipantSession = { accessKeyId: accessKey.id, sessionId: accessKey.session_id, role: accessKey.role, exp }
  // 필드가 있을 때만 포함 (하위호환 payload 유지)
  if (identity.participantId) session.participantId = identity.participantId
  if (identity.groupId) session.groupId = identity.groupId
  const payload = base64url(JSON.stringify(session))
  return `${payload}.${sign(payload)}`
}

export function readParticipantSession(value?: string | null, now = Date.now()): ParticipantSession | null {
  if (!value) return null
  const [payload, signature, ...extra] = value.split('.')
  if (!payload || !signature || extra.length > 0) return null
  if (!safeEqual(signature, sign(payload))) return null
  try {
    const parsed = JSON.parse(unbase64url(payload)) as ParticipantSession
    if (!parsed.accessKeyId || !parsed.sessionId || !parsed.role || !Number.isSafeInteger(parsed.exp)) return null
    if (parsed.exp <= now) return null
    return parsed
  } catch {
    return null
  }
}

export function participantCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    // path는 반드시 '/' — '/p'로 좁히면 /api/action, /api/p/*, /api/data/participant/*에 쿠키가 전송되지 않아
    // participant role invoke가 전부 403이 되고 참가자 대시보드가 세션을 인식하지 못한다.
    path: '/',
    maxAge: PARTICIPANT_SESSION_MAX_AGE_SEC
  }
}
