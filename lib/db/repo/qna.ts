import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Qna } from '../schema'

type Row = Record<string, unknown>
function toQna(r: Row): Qna {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    body: String(r.body),
    body_redacted: String(r.body_redacted ?? ''),
    answer: r.answer == null ? null : String(r.answer),
    status: (r.status as Qna['status']) ?? 'new',
    priority: (r.priority as Qna['priority']) ?? 'normal',
    tags: (r.tags as string[]) ?? [],
    visibility: (r.visibility as Qna['visibility']) ?? 'session',
    created_by_role: (r.created_by_role as Qna['created_by_role']) ?? 'participant',
    created_at: isoOrString(r.created_at),
    updated_at: isoOrString(r.updated_at)
  }
}

export const qna = {
  async list(ctx: RlsContext, sessionId: string): Promise<Qna[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.qna_items} from qna_items where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toQna)
    }
    return getStore().qna.filter((q) => q.session_id === sessionId)
  },
  async findById(ctx: RlsContext, id: string): Promise<Qna | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.qna_items} from qna_items where id = $1`, [id])
      return r ? toQna(r) : undefined
    }
    return getStore().qna.find((q) => q.id === id)
  },
  async insert(ctx: RlsContext, input: Omit<Qna, 'id' | 'created_at' | 'updated_at' | 'body_redacted'> & Partial<Pick<Qna, 'id' | 'body_redacted'>>): Promise<Qna> {
    const row: Qna = {
      id: input.id ?? newId('qn'),
      session_id: input.session_id,
      body: input.body,
      body_redacted: input.body_redacted ?? input.body,
      answer: input.answer ?? null,
      status: input.status ?? 'new',
      priority: input.priority ?? 'normal',
      tags: input.tags ?? [],
      visibility: input.visibility ?? 'session',
      created_by_role: input.created_by_role,
      created_at: nowIso(),
      updated_at: nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into qna_items (${COLS.qna_items}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [row.id, row.session_id, row.body, row.body_redacted, row.answer, row.status, row.priority, row.tags, row.visibility, row.created_by_role, row.created_at, row.updated_at])
      return row
    }
    getStore().qna = [...getStore().qna, row]
    bumpRevision()
    return row
  },
  async answer(ctx: RlsContext, id: string, answer: string, status: Qna['status'] = 'answered'): Promise<Qna | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update qna_items set answer = $2, status = $3, updated_at = $4 where id = $1`, [id, answer, status, nowIso()])
      return qna.findById(ctx, id)
    }
    const s = getStore()
    s.qna = s.qna.map((q) => (q.id === id ? { ...q, answer, status, updated_at: nowIso() } : q))
    bumpRevision()
    return s.qna.find((q) => q.id === id)
  },
  async updateStatus(ctx: RlsContext, id: string, status: Qna['status']): Promise<Qna | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update qna_items set status = $2, updated_at = $3 where id = $1`, [id, status, nowIso()])
      return qna.findById(ctx, id)
    }
    const s = getStore()
    s.qna = s.qna.map((q) => (q.id === id ? { ...q, status, updated_at: nowIso() } : q))
    bumpRevision()
    return s.qna.find((q) => q.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from qna_items where id = $1`, [id])
      return
    }
    const s = getStore()
    s.qna = s.qna.filter((q) => q.id !== id)
    bumpRevision()
  }
}
