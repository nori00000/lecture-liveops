// Lecture LiveOps — envelope → RlsContext 변환 (P1-1 + P2-1)
// P2-1: NextAuth server session이 있으면 우선 사용 (envelope.actor 위변조 방어).
//        session 없으면 envelope.actor 그대로 (LLM/MCP/server-internal 호출 호환).

import type { AxActionEnvelope } from './envelope'
import type { RlsContext, RlsRole } from '@/lib/db/neonHelpers'

// 숙의 신원 — route layer 가 서버 신뢰 경로(participant 쿠키)에서만 채워 넘긴다.
export type TrustedIdentity = { participantId?: string; groupId?: string }

export function envelopeToCtx(env: AxActionEnvelope, identity: TrustedIdentity = {}): RlsContext {
  return {
    role: env.actor.role,
    sessionId: env.scope.sessionId,
    sub: env.actor.userId,
    participantId: identity.participantId,
    groupId: identity.groupId
  }
}

// 비동기 버전 — NextAuth session 우선. server-only 호출 (Edge runtime 호환 X).
// API route에서 envelopeToCtx 대신 이걸 사용하면 위변조 방어 강화.
export async function envelopeToCtxWithAuth(env: AxActionEnvelope): Promise<RlsContext> {
  try {
    const { auth } = await import('@/auth')
    const session = await auth()
    const user = session?.user as { id?: string; role?: string } | undefined
    if (user?.id && user?.role) {
      return {
        role: user.role as RlsRole,
        sessionId: env.scope.sessionId,
        sub: user.id
      }
    }
  } catch {
    // auth 모듈 로드 실패 (예: edge runtime) — envelope fallback
  }
  return envelopeToCtx(env)
}
