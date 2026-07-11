import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Course } from '../schema'

type Row = Record<string, unknown>
function toCourse(r: Row): Course {
  return {
    id: String(r.id),
    company_id: String(r.company_id),
    title: String(r.title),
    description: String(r.description ?? ''),
    default_venue: String(r.default_venue ?? ''),
    status: (r.status as Course['status']) ?? 'active',
    created_at: isoOrString(r.created_at)
  }
}

export const courses = {
  async list(ctx: RlsContext): Promise<Course[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.courses} from courses order by created_at desc`)
      return rows.map(toCourse)
    }
    return [...getStore().courses]
  },
  async findByCompany(ctx: RlsContext, companyId: string): Promise<Course[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.courses} from courses where company_id = $1 order by created_at desc`, [companyId])
      return rows.map(toCourse)
    }
    return getStore().courses.filter((c) => c.company_id === companyId)
  },
  async findById(ctx: RlsContext, id: string): Promise<Course | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.courses} from courses where id = $1`, [id])
      return r ? toCourse(r) : undefined
    }
    return getStore().courses.find((c) => c.id === id)
  },
  async insert(ctx: RlsContext, input: Omit<Course, 'id' | 'created_at'> & Partial<Pick<Course, 'id' | 'created_at'>>): Promise<Course> {
    const row: Course = {
      id: input.id ?? newId('cr'),
      company_id: input.company_id,
      title: input.title,
      description: input.description ?? '',
      default_venue: input.default_venue ?? '',
      status: input.status ?? 'active',
      created_at: input.created_at ?? nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into courses (${COLS.courses}) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
        [row.id, row.company_id, row.title, row.description, row.default_venue, row.status, row.created_at])
      return row
    }
    getStore().courses = [...getStore().courses, row]
    bumpRevision()
    return row
  },
  async update(ctx: RlsContext, id: string, patch: Partial<Pick<Course, 'title' | 'description' | 'status' | 'default_venue'>>): Promise<Course | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update courses set title = coalesce($2, title), description = coalesce($3, description), status = coalesce($4, status), default_venue = coalesce($5, default_venue) where id = $1`,
        [id, patch.title ?? null, patch.description ?? null, patch.status ?? null, patch.default_venue ?? null])
      return courses.findById(ctx, id)
    }
    const s = getStore()
    s.courses = s.courses.map((c) => (c.id === id ? { ...c, ...patch } : c))
    bumpRevision()
    return s.courses.find((c) => c.id === id)
  }
}
