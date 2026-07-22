// Lecture LiveOps — 숙의 뷰 빌더 (deliberation view helpers)
// data 라우트 3종(console/participant/projector)이 공유하는 statement 카드 매핑.
// 개인 표 원자료는 절대 담지 않는다 — tally(집계)만 (거버넌스 §7-2).

import type { Statement, ModerationState } from '@/lib/db/schema'
import type { VoteTally } from '@/lib/db/repo/votes'

const EMPTY_TALLY: VoteTally = { agree: 0, disagree: 0, pass: 0 }

export type StatementCard = {
  id: string
  body: string
  groupId: string | null
  roundId: string | null
  moderationState: ModerationState
  createdAt: string
}

// 운영자 콘솔용 — 집계(tally) 포함. k-익명 억제는 프로젝터/결과판(스냅샷 지표)이 담당하므로
// 콘솔에는 운영 판단을 위해 원 집계를 그대로 노출한다 (§7-2: 개인 표가 아닌 집계는 운영자 허용).
export type StatementConsoleCard = StatementCard & {
  tally: VoteTally
  total: number
}

export function toStatementCard(s: Statement): StatementCard {
  return {
    id: s.id,
    body: s.body,
    groupId: s.group_id,
    roundId: s.round_id,
    moderationState: s.moderation_state,
    createdAt: s.created_at
  }
}

export function toConsoleCard(s: Statement, tally?: VoteTally): StatementConsoleCard {
  const t = tally ?? EMPTY_TALLY
  return {
    ...toStatementCard(s),
    tally: t,
    total: t.agree + t.disagree + t.pass
  }
}
