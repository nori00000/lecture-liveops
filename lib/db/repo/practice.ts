import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { PracticeTicket } from '../schema'

type Row = Record<string, unknown>
function toPractice(r: Row): PracticeTicket {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    table_label: String(r.table_label ?? ''),
    body: String(r.body),
    status: (r.status as PracticeTicket['status']) ?? 'help_needed',
    severity: (r.severity as PracticeTicket['severity']) ?? 'normal',
    assigned_assistant_id: r.assigned_assistant_id ? String(r.assigned_assistant_id) : null,
    created_at: isoOrString(r.created_at),
    updated_at: isoOrString(r.updated_at)
  }
}

export const practice = {
  async list(ctx: RlsContext, sessionId: string): Promise<PracticeTicket[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.practice_tickets} from practice_tickets where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toPractice)
    }
    return getStore().practice.filter((p) => p.session_id === sessionId)
  },
  async findById(ctx: RlsContext, id: string): Promise<PracticeTicket | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.practice_tickets} from practice_tickets where id = $1`, [id])
      return r ? toPractice(r) : undefined
    }
    return getStore().practice.find((p) => p.id === id)
  },
  async insert(ctx: RlsContext, input: Omit<PracticeTicket, 'id' | 'created_at' | 'updated_at'>): Promise<PracticeTicket> {
    const row: PracticeTicket = { id: newId('pt'), ...input, created_at: nowIso(), updated_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into practice_tickets (${COLS.practice_tickets}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, row.session_id, row.table_label, row.body, row.status, row.severity, row.assigned_assistant_id, row.created_at, row.updated_at])
      return row
    }
    getStore().practice = [...getStore().practice, row]
    bumpRevision()
    return row
  },
  async update(ctx: RlsContext, id: string, patch: Partial<PracticeTicket>): Promise<PracticeTicket | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update practice_tickets set status = coalesce($2, status), severity = coalesce($3, severity), assigned_assistant_id = coalesce($4, assigned_assistant_id), updated_at = $5 where id = $1`,
        [id, patch.status ?? null, patch.severity ?? null, patch.assigned_assistant_id ?? null, nowIso()])
      return practice.findById(ctx, id)
    }
    const s = getStore()
    s.practice = s.practice.map((p) => (p.id === id ? { ...p, ...patch, updated_at: nowIso() } : p))
    bumpRevision()
    return s.practice.find((p) => p.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from practice_tickets where id = $1`, [id])
      return
    }
    const s = getStore()
    s.practice = s.practice.filter((p) => p.id !== id)
    bumpRevision()
  }
}
