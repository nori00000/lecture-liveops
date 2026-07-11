import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { OpsLog } from '../schema'

type Row = Record<string, unknown>
function toOpsLog(r: Row): OpsLog {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    type: (r.type as OpsLog['type']) ?? 'note',
    body: String(r.body),
    visibility: (r.visibility as OpsLog['visibility']) ?? 'private',
    created_by_role: (r.created_by_role as OpsLog['created_by_role']) ?? 'assistant',
    created_at: isoOrString(r.created_at)
  }
}

export const opsLogs = {
  async list(ctx: RlsContext, sessionId: string): Promise<OpsLog[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.ops_logs} from ops_logs where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toOpsLog)
    }
    return getStore()
      .ops_logs.filter((o) => o.session_id === sessionId)
      .slice()
      .sort((a, b) => (b.created_at < a.created_at ? -1 : 1))
  },
  async insert(ctx: RlsContext, input: Omit<OpsLog, 'id' | 'created_at'>): Promise<OpsLog> {
    const row: OpsLog = { id: newId('op'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into ops_logs (${COLS.ops_logs}) values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.session_id, row.type, row.body, row.visibility, row.created_by_role, row.created_at])
      return row
    }
    getStore().ops_logs = [...getStore().ops_logs, row]
    bumpRevision()
    return row
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from ops_logs where id = $1`, [id])
      return
    }
    const s = getStore()
    s.ops_logs = s.ops_logs.filter((o) => o.id !== id)
    bumpRevision()
  }
}
