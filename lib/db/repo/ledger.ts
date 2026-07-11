import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { ActionLedger } from '../schema'

type Row = Record<string, unknown>
function toLedger(r: Row): ActionLedger {
  return {
    id: String(r.id),
    session_id: r.session_id ? String(r.session_id) : null,
    actor_type: (r.actor_type as ActionLedger['actor_type']) ?? 'human',
    actor_role: (r.actor_role as ActionLedger['actor_role']) ?? 'participant',
    tool: (r.tool as ActionLedger['tool']) ?? 'web-ui',
    action_name: String(r.action_name),
    input_hash: String(r.input_hash),
    input_redacted_summary: String(r.input_redacted_summary ?? ''),
    output_summary: String(r.output_summary ?? ''),
    status: (r.status as ActionLedger['status']) ?? 'ok',
    created_at: isoOrString(r.created_at)
  }
}

export const ledger = {
  async list(ctx: RlsContext, limit = 100): Promise<ActionLedger[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.action_ledger} from action_ledger order by created_at desc limit $1`, [limit])
      return rows.map(toLedger)
    }
    return getStore().action_ledger.slice(-limit).reverse()
  },
  async listBySession(ctx: RlsContext, sessionId: string, limit = 100): Promise<ActionLedger[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.action_ledger} from action_ledger where session_id = $1 order by created_at desc limit $2`, [sessionId, limit])
      return rows.map(toLedger)
    }
    return getStore().action_ledger.filter((l) => l.session_id === sessionId).slice(-limit).reverse()
  },
  async insert(ctx: RlsContext, input: Omit<ActionLedger, 'id' | 'created_at'>): Promise<ActionLedger> {
    const row: ActionLedger = { id: newId('al'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into action_ledger (${COLS.action_ledger}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [row.id, row.session_id, row.actor_type, row.actor_role, row.tool, row.action_name, row.input_hash, row.input_redacted_summary, row.output_summary, row.status, row.created_at])
      return row
    }
    getStore().action_ledger = [...getStore().action_ledger, row]
    bumpRevision()
    return row
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from action_ledger where id = $1`, [id])
      return
    }
    const s = getStore()
    s.action_ledger = s.action_ledger.filter((l) => l.id !== id)
    bumpRevision()
  }
}
