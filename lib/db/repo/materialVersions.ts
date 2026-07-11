import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import type { MaterialVersionRow, Resource } from '../schema'

export const materialVersions = {
  async listBySession(sessionId: string): Promise<MaterialVersionRow[]> {
    const store = getStore()
    const explicit = store.material_versions.filter((m) => m.session_id === sessionId)
    const fromResources = store.resources
      .filter((r) => r.session_id === sessionId)
      .filter((r) => !explicit.some((m) => m.resource_id === r.id))
      .map(resourceToMaterial)
    return [...explicit, ...fromResources].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  },
  async upsert(input: Omit<MaterialVersionRow, 'id' | 'updated_at'> & Partial<Pick<MaterialVersionRow, 'id' | 'updated_at'>>): Promise<MaterialVersionRow> {
    const row: MaterialVersionRow = {
      id: input.id ?? newId('mv'),
      session_id: input.session_id,
      resource_id: input.resource_id,
      title: input.title,
      type: input.type,
      url_or_storage_path: input.url_or_storage_path,
      status: input.status ?? 'draft',
      audience: input.audience ?? 'all',
      version: input.version ?? 1,
      latest_change_summary: input.latest_change_summary,
      updated_by: input.updated_by,
      updated_at: input.updated_at ?? nowIso()
    }
    const s = getStore()
    s.material_versions = [
      ...s.material_versions.filter((m) => m.id !== row.id && (!row.resource_id || m.resource_id !== row.resource_id)),
      row
    ]
    bumpRevision()
    return row
  }
}

function resourceToMaterial(r: Resource): MaterialVersionRow {
  return {
    id: `mv-${r.id}`,
    session_id: r.session_id,
    resource_id: r.id,
    title: r.title,
    type: r.type,
    url_or_storage_path: r.url_or_storage_path,
    status: r.visibility === 'public' ? 'shared' : 'review',
    audience: r.visibility === 'public' ? 'participants' : 'instructors',
    version: 1,
    latest_change_summary: '기존 자료 보드에서 가져온 항목',
    updated_by: 'seed',
    updated_at: r.created_at
  }
}
