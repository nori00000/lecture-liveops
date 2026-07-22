// Lecture LiveOps — 숙의 발언 repo (statements + moderation_events)
// dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, withTxn, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Statement, ModerationEvent, ModerationState, ModerationAction, ModerationActorRole, EvidenceKind } from '../schema'

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
    // Q1: 근거 유형 자기 태깅. 미지정은 null (fixture/Neon 동일).
    evidence_kind: r.evidence_kind == null ? null : (r.evidence_kind as EvidenceKind),
    created_at: isoOrString(r.created_at)
  }
}

function toModerationEvent(r: Row): ModerationEvent {
  return {
    id: String(r.id),
    statement_id: String(r.statement_id),
    actor_role: (r.actor_role as ModerationActorRole) ?? 'operator',
    action: (r.action as ModerationAction) ?? 'flag',
    reason: String(r.reason ?? ''),
    created_at: isoOrString(r.created_at)
  }
}

// moderation 상태전이표 (M-5) — 현재 상태에서 허용되는 action 만. 무의미/불가 전이는 거부한다.
//   visible: flag→flagged, hide→hidden (restore/approve 는 no-op → 거부)
//   flagged: hide→hidden, restore/approve→visible (flag 재신고 no-op → 거부)
//   hidden : restore/approve→visible (hide/flag no-op → 거부)
const MODERATION_TRANSITIONS: Record<ModerationState, Partial<Record<ModerationAction, ModerationState>>> = {
  visible: { flag: 'flagged', hide: 'hidden' },
  flagged: { hide: 'hidden', restore: 'visible', approve: 'visible' },
  hidden: { restore: 'visible', approve: 'visible' }
}

export const statements = {
  async list(ctx: RlsContext, sessionId: string, roundId?: string, opts: { visibleOnly?: boolean } = {}): Promise<Statement[]> {
    // visibleOnly: 집계(computeSnapshot)는 moderation_state='visible' 만 포함 (M-1). hidden/flagged 제외.
    const visClause = opts.visibleOnly ? ` and moderation_state = 'visible'` : ''
    if (isNeonEnabled()) {
      if (roundId) {
        const rows = await query(ctx, `select ${COLS.statements} from statements where session_id = $1 and round_id = $2${visClause} order by created_at asc`, [sessionId, roundId])
        return rows.map(toStatement)
      }
      const rows = await query(ctx, `select ${COLS.statements} from statements where session_id = $1${visClause} order by created_at asc`, [sessionId])
      return rows.map(toStatement)
    }
    return getStore().statements.filter((s) =>
      s.session_id === sessionId &&
      (roundId ? s.round_id === roundId : true) &&
      (opts.visibleOnly ? s.moderation_state === 'visible' : true)
    )
  },
  async findById(ctx: RlsContext, id: string): Promise<Statement | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.statements} from statements where id = $1`, [id])
      return r ? toStatement(r) : undefined
    }
    return getStore().statements.find((s) => s.id === id)
  },
  // evidence_kind 는 선택 입력 — 미지정 호출자(기존 경로)는 그대로 동작한다.
  async submit(ctx: RlsContext, input: Omit<Statement, 'id' | 'created_at' | 'moderation_state' | 'evidence_kind'> & Partial<Pick<Statement, 'id' | 'moderation_state' | 'evidence_kind'>>): Promise<Statement> {
    const row: Statement = {
      id: input.id ?? newId('st'),
      session_id: input.session_id,
      round_id: input.round_id ?? null,
      group_id: input.group_id ?? null,
      author_participant_id: input.author_participant_id ?? null,
      body: input.body,
      visibility: input.visibility ?? 'group',
      moderation_state: input.moderation_state ?? 'visible',
      // Q1: 미지정 허용 — 참가자가 고르지 않으면 null 로 저장한다 (fixture/Neon 동일).
      evidence_kind: input.evidence_kind ?? null,
      created_at: nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into statements (${COLS.statements}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [row.id, row.session_id, row.round_id, row.group_id, row.author_participant_id, row.body, row.visibility, row.moderation_state, row.created_at, row.evidence_kind])
      return row
    }
    getStore().statements = [...getStore().statements, row]
    bumpRevision()
    return row
  },
  // 신고/숨김/복원 — 상태전이표 검증 + moderation_events 감사 기록 (원자, M-5).
  // 없는 발언은 undefined, 허용되지 않는 전이는 throw. actorRole 은 서버가 확인 가능한 감사 주체만 받는다 (M3).
  async moderate(ctx: RlsContext, statementId: string, action: ModerationAction, actorRole: ModerationActorRole, reason = ''): Promise<Statement | undefined> {
    const current = await statements.findById(ctx, statementId)
    if (!current) return undefined
    const nextState = MODERATION_TRANSITIONS[current.moderation_state]?.[action]
    if (!nextState) {
      throw new Error(`delib: invalid moderation transition ${current.moderation_state} --${action}-->`)
    }
    const eventId = newId('me')
    const now = nowIso()
    if (isNeonEnabled()) {
      // 상태 전이 + 감사 기록을 한 트랜잭션으로 (부분 적용 방지).
      await withTxn(ctx, (sql) => [
        sql`update statements set moderation_state = ${nextState} where id = ${statementId}`,
        sql`insert into moderation_events (id, statement_id, actor_role, action, reason, created_at)
            values (${eventId}, ${statementId}, ${actorRole}, ${action}, ${reason}, ${now})`
      ])
      return statements.findById(ctx, statementId)
    }
    const s = getStore()
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
  },
  async listModerationEventsByStatementIds(ctx: RlsContext, statementIds: string[]): Promise<Record<string, ModerationEvent[]>> {
    const uniqueIds = Array.from(new Set(statementIds))
    const grouped: Record<string, ModerationEvent[]> = Object.fromEntries(uniqueIds.map((id) => [id, []]))
    if (uniqueIds.length === 0) return grouped
    const rows = isNeonEnabled()
      ? (await query(ctx, `select ${COLS.moderation_events} from moderation_events where statement_id = any($1) order by statement_id asc, created_at asc`, [uniqueIds])).map(toModerationEvent)
      : getStore()
        .moderation_events
        .filter((e) => uniqueIds.includes(e.statement_id))
        .slice()
        .sort((a, b) => a.statement_id.localeCompare(b.statement_id) || a.created_at.localeCompare(b.created_at))
    for (const event of rows) {
      grouped[event.statement_id] ??= []
      grouped[event.statement_id].push(event)
    }
    return grouped
  }
}
