import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Resource } from '../schema'

type Row = Record<string, unknown>
function toResource(r: Row): Resource {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    type: (r.type as Resource['type']) ?? 'link',
    title: String(r.title),
    url_or_storage_path: String(r.url_or_storage_path),
    visibility: (r.visibility as Resource['visibility']) ?? 'session',
    stage_tags: (r.stage_tags as string[]) ?? [],
    audience_tags: (r.audience_tags as string[]) ?? [],
    created_at: isoOrString(r.created_at)
  }
}

export const resources = {
  async list(ctx: RlsContext, sessionId: string): Promise<Resource[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.resources} from resources where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toResource)
    }
    return getStore().resources.filter((r) => r.session_id === sessionId)
  },
  async insert(ctx: RlsContext, input: Omit<Resource, 'id' | 'created_at'>): Promise<Resource> {
    const row: Resource = { id: newId('rs'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into resources (${COLS.resources}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, row.session_id, row.type, row.title, row.url_or_storage_path, row.visibility, row.stage_tags, row.audience_tags, row.created_at])
      return row
    }
    getStore().resources = [...getStore().resources, row]
    bumpRevision()
    return row
  },
  async updateVisibility(ctx: RlsContext, id: string, visibility: Resource['visibility']): Promise<Resource | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update resources set visibility = $2 where id = $1`, [id, visibility])
      const list = await query(ctx, `select ${COLS.resources} from resources where id = $1`, [id])
      return list[0] ? toResource(list[0]) : undefined
    }
    const s = getStore()
    s.resources = s.resources.map((r) => (r.id === id ? { ...r, visibility } : r))
    bumpRevision()
    return s.resources.find((r) => r.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from resources where id = $1`, [id])
      return
    }
    const s = getStore()
    s.resources = s.resources.filter((r) => r.id !== id)
    bumpRevision()
  }
}
