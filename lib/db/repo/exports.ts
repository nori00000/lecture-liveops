import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { ExportJob, ExternalArchive } from '../schema'

type Row = Record<string, unknown>
function toJob(r: Row): ExportJob {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    profile: (r.profile as ExportJob['profile']) ?? 'internal_retro',
    formats: (r.formats as ExportJob['formats']) ?? [],
    status: (r.status as ExportJob['status']) ?? 'queued',
    output_paths: (r.output_paths as Record<string, unknown>) ?? {},
    created_at: isoOrString(r.created_at)
  }
}

function toArchive(r: Row): ExternalArchive {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    target_path: String(r.target_path),
    status: (r.status as ExternalArchive['status']) ?? 'planned',
    frontmatter: (r.frontmatter as Record<string, unknown>) ?? {},
    created_at: isoOrString(r.created_at)
  }
}

export const exportJobs = {
  async list(ctx: RlsContext, sessionId?: string): Promise<ExportJob[]> {
    if (isNeonEnabled()) {
      const rows = sessionId
        ? await query(ctx, `select ${COLS.export_jobs} from export_jobs where session_id = $1 order by created_at desc`, [sessionId])
        : await query(ctx, `select ${COLS.export_jobs} from export_jobs order by created_at desc`)
      return rows.map(toJob)
    }
    const all = getStore().export_jobs
    return sessionId ? all.filter((e) => e.session_id === sessionId) : [...all]
  },
  async insert(ctx: RlsContext, input: Omit<ExportJob, 'id' | 'created_at'>): Promise<ExportJob> {
    const row: ExportJob = { id: newId('xj'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into export_jobs (${COLS.export_jobs}) values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.session_id, row.profile, row.formats, row.status, JSON.stringify(row.output_paths), row.created_at])
      return row
    }
    getStore().export_jobs = [...getStore().export_jobs, row]
    bumpRevision()
    return row
  },
  async updateStatus(ctx: RlsContext, id: string, status: ExportJob['status']): Promise<ExportJob | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update export_jobs set status = $2 where id = $1`, [id, status])
      const list = await query(ctx, `select ${COLS.export_jobs} from export_jobs where id = $1`, [id])
      return list[0] ? toJob(list[0]) : undefined
    }
    const s = getStore()
    s.export_jobs = s.export_jobs.map((j) => (j.id === id ? { ...j, status } : j))
    bumpRevision()
    return s.export_jobs.find((j) => j.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from export_jobs where id = $1`, [id])
      return
    }
    const s = getStore()
    s.export_jobs = s.export_jobs.filter((j) => j.id !== id)
    bumpRevision()
  }
}

export const externalArchives = {
  async list(ctx: RlsContext, sessionId?: string): Promise<ExternalArchive[]> {
    if (isNeonEnabled()) {
      const rows = sessionId
        ? await query(ctx, `select ${COLS.external_archives} from external_archives where session_id = $1 order by created_at desc`, [sessionId])
        : await query(ctx, `select ${COLS.external_archives} from external_archives order by created_at desc`)
      return rows.map(toArchive)
    }
    const all = getStore().external_archives
    return sessionId ? all.filter((o) => o.session_id === sessionId) : [...all]
  },
  async insert(ctx: RlsContext, input: Omit<ExternalArchive, 'id' | 'created_at'>): Promise<ExternalArchive> {
    const row: ExternalArchive = { id: newId('oa'), ...input, created_at: nowIso() }
    if (isNeonEnabled()) {
      await query(ctx, `insert into external_archives (${COLS.external_archives}) values ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.session_id, row.target_path, row.status, JSON.stringify(row.frontmatter), row.created_at])
      return row
    }
    getStore().external_archives = [...getStore().external_archives, row]
    bumpRevision()
    return row
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from external_archives where id = $1`, [id])
      return
    }
    const s = getStore()
    s.external_archives = s.external_archives.filter((o) => o.id !== id)
    bumpRevision()
  }
}
