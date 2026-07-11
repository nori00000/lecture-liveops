import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { AssistantSignal, TableStatus } from '../schema'

type Row = Record<string, unknown>
function toSignal(r: Row): AssistantSignal {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    signal_type: (r.signal_type as AssistantSignal['signal_type']),
    table_label: String(r.table_label ?? ''),
    note: String(r.note ?? ''),
    acknowledged_at: r.acknowledged_at ? isoOrString(r.acknowledged_at) : null,
    created_at: isoOrString(r.created_at)
  }
}

function toTableStatus(r: Row): TableStatus {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    table_label: String(r.table_label),
    progress: (r.progress as TableStatus['progress']) ?? 'not_started',
    blocker: String(r.blocker ?? ''),
    assistant_id: r.assistant_id ? String(r.assistant_id) : null,
    updated_at: isoOrString(r.updated_at)
  }
}

export const signals = {
  async list(ctx: RlsContext, sessionId: string): Promise<AssistantSignal[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.assistant_signals} from assistant_signals where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toSignal)
    }
    return getStore()
      .signals.filter((s) => s.session_id === sessionId)
      .slice()
      .sort((a, b) => (b.created_at < a.created_at ? -1 : 1))
  },
  async insert(ctx: RlsContext, input: Omit<AssistantSignal, 'id' | 'created_at'>): Promise<AssistantSignal> {
    const row: AssistantSignal = { id: newId('sg'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into assistant_signals (${COLS.assistant_signals}) values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.session_id, row.signal_type, row.table_label, row.note, row.acknowledged_at, row.created_at])
      return row
    }
    getStore().signals = [...getStore().signals, row]
    bumpRevision()
    return row
  },
  async acknowledge(ctx: RlsContext, id: string): Promise<AssistantSignal | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update assistant_signals set acknowledged_at = $2 where id = $1`, [id, nowIso()])
      const list = await query(ctx, `select ${COLS.assistant_signals} from assistant_signals where id = $1`, [id])
      return list[0] ? toSignal(list[0]) : undefined
    }
    const s = getStore()
    s.signals = s.signals.map((sg) => (sg.id === id ? { ...sg, acknowledged_at: nowIso() } : sg))
    bumpRevision()
    return s.signals.find((sg) => sg.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from assistant_signals where id = $1`, [id])
      return
    }
    const s = getStore()
    s.signals = s.signals.filter((sg) => sg.id !== id)
    bumpRevision()
  }
}

export const tableStatuses = {
  async list(ctx: RlsContext, sessionId: string): Promise<TableStatus[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.table_statuses} from table_statuses where session_id = $1`, [sessionId])
      return rows.map(toTableStatus)
    }
    return getStore().table_statuses.filter((t) => t.session_id === sessionId)
  },
  async upsert(ctx: RlsContext, input: { session_id: string; table_label: string; progress: TableStatus['progress']; blocker?: string; assistant_id?: string | null }): Promise<TableStatus> {
    if (isNeonEnabled()) {
      const id = newId('ts')
      const updated_at = nowIso()
      await query(ctx, `insert into table_statuses (${COLS.table_statuses}) values ($1,$2,$3,$4,$5,$6,$7) on conflict (session_id, table_label) do update set progress = excluded.progress, blocker = excluded.blocker, assistant_id = excluded.assistant_id, updated_at = excluded.updated_at`,
        [id, input.session_id, input.table_label, input.progress, input.blocker ?? '', input.assistant_id ?? null, updated_at])
      const list = await query(ctx, `select ${COLS.table_statuses} from table_statuses where session_id = $1 and table_label = $2`,
        [input.session_id, input.table_label])
      return toTableStatus(list[0]!)
    }
    const s = getStore()
    const existing = s.table_statuses.find((t) => t.session_id === input.session_id && t.table_label === input.table_label)
    if (existing) {
      s.table_statuses = s.table_statuses.map((t) =>
        t.id === existing.id
          ? { ...t, progress: input.progress, blocker: input.blocker ?? '', assistant_id: input.assistant_id ?? null, updated_at: nowIso() }
          : t
      )
      bumpRevision()
      return s.table_statuses.find((t) => t.id === existing.id)!
    }
    const row: TableStatus = {
      id: newId('ts'),
      session_id: input.session_id,
      table_label: input.table_label,
      progress: input.progress,
      blocker: input.blocker ?? '',
      assistant_id: input.assistant_id ?? null,
      updated_at: nowIso()
    }
    s.table_statuses = [...s.table_statuses, row]
    bumpRevision()
    return row
  }
}
