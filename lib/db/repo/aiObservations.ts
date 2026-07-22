// Lecture LiveOps — Q2 검토 후보 repo (round_ai_observations)
// dual-mode 패턴: Neon query / fixture getStore(). 0019 마이그레이션 대응.
//
// 접근 경계: 이 테이블은 operator 전용이다 (RLS 가 participant 를 select 단계에서 차단).
// repo 는 ctx 를 그대로 넘길 뿐이므로 Neon 경로에서도 operator 역할로만 동작해야 한다 —
// participant ctx 로 호출하면 RLS 가 빈 결과/실패를 돌려준다.

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, withTxn, COLS, isoOrString, type Row as NeonRow, type RlsContext } from '../neonHelpers'
import type { RoundAiObservation, AiObservationKind, AiObservationStatus } from '../schema'

type Row = Record<string, unknown>

function toObservation(r: Row): RoundAiObservation {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    round_id: r.round_id == null ? null : String(r.round_id),
    statement_id: String(r.statement_id),
    kind: (r.kind as AiObservationKind) ?? 'evidence_check',
    body: String(r.body ?? ''),
    suggested_question: String(r.suggested_question ?? ''),
    status: (r.status as AiObservationStatus) ?? 'pending',
    reviewed_by: r.reviewed_by == null ? null : String(r.reviewed_by),
    reviewed_at: r.reviewed_at == null ? null : isoOrString(r.reviewed_at),
    review_reason: String(r.review_reason ?? ''),
    provider: String(r.provider ?? 'stub'),
    created_at: isoOrString(r.created_at)
  }
}

export type AiObservationInsert = {
  session_id: string
  round_id?: string | null
  statement_id: string
  kind: AiObservationKind
  body: string
  suggested_question?: string
  provider?: string
}

export const aiObservations = {
  // 세션 전체 후보. status 필터는 선택 (리포트는 approved 만 읽는다).
  async list(ctx: RlsContext, sessionId: string, opts: { status?: AiObservationStatus } = {}): Promise<RoundAiObservation[]> {
    if (isNeonEnabled()) {
      if (opts.status) {
        const rows = await query(ctx, `select ${COLS.round_ai_observations} from round_ai_observations where session_id = $1 and status = $2 order by created_at asc, id asc`, [sessionId, opts.status])
        return rows.map(toObservation)
      }
      const rows = await query(ctx, `select ${COLS.round_ai_observations} from round_ai_observations where session_id = $1 order by created_at asc, id asc`, [sessionId])
      return rows.map(toObservation)
    }
    return getStore()
      .round_ai_observations.filter((o) => o.session_id === sessionId && (opts.status ? o.status === opts.status : true))
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  },

  async findById(ctx: RlsContext, id: string): Promise<RoundAiObservation | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.round_ai_observations} from round_ai_observations where id = $1`, [id])
      return r ? toObservation(r) : undefined
    }
    return getStore().round_ai_observations.find((o) => o.id === id)
  },

  // 후보 저장 — 전부 pending 으로 들어간다. 승인 전에는 리포트에 실리지 않는다.
  async insertMany(ctx: RlsContext, inputs: AiObservationInsert[]): Promise<RoundAiObservation[]> {
    if (inputs.length === 0) return []
    const rows: RoundAiObservation[] = inputs.map((i) => ({
      id: newId('aio'),
      session_id: i.session_id,
      round_id: i.round_id ?? null,
      statement_id: i.statement_id,
      kind: i.kind,
      body: i.body,
      suggested_question: i.suggested_question ?? '',
      status: 'pending',
      reviewed_by: null,
      reviewed_at: null,
      review_reason: '',
      provider: i.provider ?? 'stub',
      created_at: nowIso()
    }))
    if (isNeonEnabled()) {
      const results = await withTxn(ctx, (sql) =>
        rows.map((row) =>
          sql.query(
            `insert into round_ai_observations (${COLS.round_ai_observations}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing returning ${COLS.round_ai_observations}`,
            [row.id, row.session_id, row.round_id, row.statement_id, row.kind, row.body, row.suggested_question, row.status, row.reviewed_by, row.reviewed_at, row.review_reason, row.provider, row.created_at]
          )
        )
      )
      return (results as NeonRow[][]).flat().map(toObservation)
    }
    const s = getStore()
    const activeKeys = new Set(
      s.round_ai_observations
        .filter((o) => o.status !== 'rejected')
        .map((o) => `${o.session_id}:${o.statement_id}:${o.kind}`)
    )
    const accepted: RoundAiObservation[] = []
    for (const row of rows) {
      const key = `${row.session_id}:${row.statement_id}:${row.kind}`
      if (activeKeys.has(key)) continue
      activeKeys.add(key)
      accepted.push(row)
    }
    s.round_ai_observations = [...s.round_ai_observations, ...accepted]
    bumpRevision()
    return accepted
  },

  // 승인/기각 — 이미 검토된 항목은 다시 바꾸지 않는다(기각은 영구 제외).
  async review(
    ctx: RlsContext,
    id: string,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    reason = ''
  ): Promise<RoundAiObservation | undefined> {
    const now = nowIso()
    if (isNeonEnabled()) {
      const rows = await query(
        ctx,
        `update round_ai_observations set status = $2, reviewed_by = $3, reviewed_at = $4, review_reason = $5 where id = $1 and status = 'pending' returning ${COLS.round_ai_observations}`,
        [id, status, reviewedBy, now, reason]
      )
      if (rows.length === 0) throw new Error('delib: ai observation already reviewed or not found')
      return toObservation(rows[0])
    }
    const s = getStore()
    const current = s.round_ai_observations.find((o) => o.id === id)
    if (!current || current.status !== 'pending') {
      throw new Error('delib: ai observation already reviewed or not found')
    }
    s.round_ai_observations = s.round_ai_observations.map((o) =>
      o.id === id ? { ...o, status, reviewed_by: reviewedBy, reviewed_at: now, review_reason: reason } : o
    )
    bumpRevision()
    return s.round_ai_observations.find((o) => o.id === id)
  },

  // 재계산 시 기존 pending 후보를 정리한다 (승인·기각된 것은 감사 기록으로 보존).
  async deletePending(ctx: RlsContext, sessionId: string, roundId: string | null): Promise<number> {
    if (isNeonEnabled()) {
      const rows = roundId
        ? await query(ctx, `delete from round_ai_observations where session_id = $1 and round_id = $2 and status = 'pending' returning id`, [sessionId, roundId])
        : await query(ctx, `delete from round_ai_observations where session_id = $1 and status = 'pending' returning id`, [sessionId])
      return rows.length
    }
    const s = getStore()
    const before = s.round_ai_observations.length
    s.round_ai_observations = s.round_ai_observations.filter(
      (o) => !(o.session_id === sessionId && o.status === 'pending' && (roundId ? o.round_id === roundId : true))
    )
    bumpRevision()
    return before - s.round_ai_observations.length
  }
}
