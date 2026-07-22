// Lecture LiveOps — 숙의 투표 repo (statement_votes)
// dual-mode 패턴: Neon query / fixture getStore()
// 중복 투표는 upsert 로 변경 허용, unique(statement_id, participant_id) 가 최종 방어선.
// 집계는 개인 표 원자료 노출 없이 delib_vote_tally (security definer) 로만 노출 (거버넌스 §7-2).

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { StatementVote, VoteValue } from '../schema'

type Row = Record<string, unknown>

// statement_id → 찬반유보 집계
export type VoteTally = { agree: number; disagree: number; pass: number }

function toVote(r: Row): StatementVote {
  return {
    id: String(r.id),
    statement_id: String(r.statement_id),
    participant_id: String(r.participant_id),
    vote: (r.vote as VoteValue) ?? 'pass',
    created_at: isoOrString(r.created_at)
  }
}

export const votes = {
  // unique(statement_id, participant_id) upsert — 재투표 시 vote 변경
  async cast(ctx: RlsContext, input: { statement_id: string; participant_id: string; vote: VoteValue }): Promise<StatementVote> {
    if (isNeonEnabled()) {
      const id = newId('sv')
      const now = nowIso()
      await query(ctx, `insert into statement_votes (${COLS.statement_votes}) values ($1,$2,$3,$4,$5) on conflict (statement_id, participant_id) do update set vote = excluded.vote, created_at = excluded.created_at`,
        [id, input.statement_id, input.participant_id, input.vote, now])
      return { id, statement_id: input.statement_id, participant_id: input.participant_id, vote: input.vote, created_at: now }
    }
    const s = getStore()
    const existing = s.statement_votes.find((v) => v.statement_id === input.statement_id && v.participant_id === input.participant_id)
    if (existing) {
      const now = nowIso()
      s.statement_votes = s.statement_votes.map((v) => (v.id === existing.id ? { ...v, vote: input.vote, created_at: now } : v))
      bumpRevision()
      return s.statement_votes.find((v) => v.id === existing.id)!
    }
    const row: StatementVote = { id: newId('sv'), statement_id: input.statement_id, participant_id: input.participant_id, vote: input.vote, created_at: nowIso() }
    s.statement_votes = [...s.statement_votes, row]
    bumpRevision()
    return row
  },
  // 개인 표 원자료가 아니라 statement 별 집계만 반환.
  async tallyByStatements(ctx: RlsContext, statementIds: string[]): Promise<Record<string, VoteTally>> {
    const out: Record<string, VoteTally> = {}
    for (const sid of statementIds) out[sid] = { agree: 0, disagree: 0, pass: 0 }
    if (statementIds.length === 0) return out
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select statement_id, agree, disagree, pass from delib_vote_tally($1)`, [statementIds])
      for (const r of rows) {
        out[String(r.statement_id)] = { agree: Number(r.agree ?? 0), disagree: Number(r.disagree ?? 0), pass: Number(r.pass ?? 0) }
      }
      return out
    }
    const ids = new Set(statementIds)
    for (const v of getStore().statement_votes) {
      if (!ids.has(v.statement_id)) continue
      const t = out[v.statement_id]
      if (v.vote === 'agree') t.agree += 1
      else if (v.vote === 'disagree') t.disagree += 1
      else t.pass += 1
    }
    return out
  },
  // 개인 표 원자료 raw 조회 — admin 전용 (거버넌스 §7-2, N-3). Neon RLS(ax_delib_votes_admin_read)와
  // 동일 경계를 fixture 에서도 명시 강제한다. 집계는 tallyByStatements(delib_vote_tally)만 사용할 것.
  async listByStatement(ctx: RlsContext, statementId: string): Promise<StatementVote[]> {
    if (ctx.role !== 'admin') {
      throw new Error('delib: statement_votes raw read is admin-only')
    }
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.statement_votes} from statement_votes where statement_id = $1`, [statementId])
      return rows.map(toVote)
    }
    return getStore().statement_votes.filter((v) => v.statement_id === statementId)
  }
}
