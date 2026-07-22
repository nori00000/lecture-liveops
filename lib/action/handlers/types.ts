import type { AxActionEnvelope } from '../envelope'
import type { TrustedIdentity } from '../context'

export type HandlerContext = {
  envelope: AxActionEnvelope
  // 서버 신뢰 신원 — route 가 participant 쿠키에서만 주입. handler 는 input 의 participantId 를
  // 무시하고 이 값을 사용해야 한다 (투표/발언 위조 방어, C-A/C-B/C-E).
  trusted?: TrustedIdentity
}

export type Handler = (ctx: HandlerContext) => Promise<{ data?: unknown; summary?: string }>
