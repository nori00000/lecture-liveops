// Lecture LiveOps — 숙의 발언 repo (statements + moderation_events)
// dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Statement, ModerationEvent, ModerationState, ModerationAction, Role } from '../schema'

type Row = Record<string, unknown>

function toStatement(r: Row): Statement {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    round_id: r.round_id == null ? null : String(r.round_id),
    group_id: r.group_id == null ? null : String(r.group_id),
    author_participant_id: r.author_participant_id == null ? null : String(r.author_participant_id),
    body: String(r.body ?? ''),
    visibility: (r.visibility as Statement['visibility']) ?? 'group',
    moderation_state: (r.moderation_state as Statement['moderation_state']) ?? 'visible',
    created_at: isoOrString(r.created_at)
  }
}

function toModerationEvent(r: Row): ModerationEvent {
  return {
    id: String(r.id),
    statement_id: String(r.statement_id),
    actor_role: (r.actor_role as Role) ?? 'instructor',
    action: (r.action as ModerationAction) ?? 'flag',
    reason: String(r.reason ?? ''),
    created_at: isoOrString(r.created_at)
  }
}

// moderation action → 결과 상태 전이
const MODERATION_TRANSITION: Record<ModerationAction, ModerationState> = {
  flag: 'flagged',
  hide: 'hidden',
  restore: 'visible',
  approve: 'visible'
}

export const statements = {
  async list(ctx: RlsContext, sessionId: string, roundId?: string): Promise<Statement[]> {
    if (isNeonEnabled()) {
      if (roundId) {
        const rows = await query(ctx, `select ${COLS.statements} from statements where session_id = $1 and round_id = $2 order by created_at asc`, [sessionId, roundId])
        return rows.map(toStatement)
      }
      const rows = await query(ctx, `select ${COLS.statements} from statements where session_id = $1 order by created_at asc`, [sessionId])
      return rows.map(toStatement)
    }
    return getStore().statements.filter((s) => s.session_id === sessionId && (roundId ? s.round_id === roundId : true))
  },
  async findById(ctx: RlsContext, id: string): Promise<Statement | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.statements} from statements where id = $1`, [id])
      return r ? toStatement(r) : undefined
    }
    return getStore().statements.find((s) => s.id === id)
  },
  async submit(ctx: RlsContext, input: Omit<Statement, 'id' | 'created_at' | 'moderation_state'> & Partial<Pick<Statement, 'id' | 'moderation_state'>>): Promise<Statement> {
    const row: Statement = {
      id: input.id ?? newId('st'),
      session_id: input.session_id,
      round_id: input.round_id ?? null,
      group_id: input.group_id ?? null,
      author_participant_id: input.author_participant_id ?? null,
      body: input.body,
      visibility: input.visibility ?? 'group',
      moderation_state: input.moderation_state ?? 'visible',
      created_at: nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into statements (${COLS.statements}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, row.session_id, row.round_id, row.group_id, row.author_participant_id, row.body, row.visibility, row.moderation_state, row.created_at])
      return row
    }
    getStore().statements = [...getStore().statements, row]
    bumpRevision()
    return row
  },
  // 신고/숨김/복원 — 상태 전이 + moderation_events 감사 기록 (원자)
  async moderate(ctx: RlsContext, statementId: string, action: ModerationAction, actorRole: Role, reason = ''): Promise<Statement | undefined> {
    const nextState = MODERATION_TRANSITION[action]
    const eventId = newId('me')
    const now = nowIso()
    if (isNeonEnabled()) {
      await query(ctx, `update statements set moderation_state = $2 where id = $1`, [statementId, nextState])
      await query(ctx, `insert into moderation_events (${COLS.moderation_events}) values ($1,$2,$3,$4,$5,$6)`,
        [eventId, statementId, actorRole, action, reason, now])
      return statements.findById(ctx, statementId)
    }
    const s = getStore()
    const existing = s.statements.find((x) => x.id === statementId)
    if (!existing) return undefined
    s.statements = s.statements.map((x) => (x.id === statementId ? { ...x, moderation_state: nextState } : x))
    s.moderation_events = [...s.moderation_events, { id: eventId, statement_id: statementId, actor_role: actorRole, action, reason, created_at: now }]
    bumpRevision()
    return s.statements.find((x) => x.id === statementId)
  },
  async listModerationEvents(ctx: RlsContext, statementId: string): Promise<ModerationEvent[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.moderation_events} from moderation_events where statement_id = $1 order by created_at asc`, [statementId])
      return rows.map(toModerationEvent)
    }
    return getStore().moderation_events.filter((e) => e.statement_id === statementId)
  }
}
