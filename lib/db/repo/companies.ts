import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Company } from '../schema'

type Row = Record<string, unknown>
function toCompany(r: Row): Company {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    visibility: (r.visibility as Company['visibility']) ?? 'private',
    retention_policy: String(r.retention_policy ?? '30d'),
    created_at: isoOrString(r.created_at)
  }
}

export const companies = {
  async list(ctx: RlsContext): Promise<Company[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.companies} from companies order by name`)
      return rows.map(toCompany)
    }
    return [...getStore().companies]
  },
  async findById(ctx: RlsContext, id: string): Promise<Company | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.companies} from companies where id = $1`, [id])
      return r ? toCompany(r) : undefined
    }
    return getStore().companies.find((c) => c.id === id)
  },
  async insert(ctx: RlsContext, input: Omit<Company, 'id' | 'created_at'> & Partial<Pick<Company, 'id' | 'created_at'>>): Promise<Company> {
    const row: Company = {
      id: input.id ?? newId('co'),
      name: input.name,
      slug: input.slug,
      visibility: input.visibility ?? 'private',
      retention_policy: input.retention_policy ?? '30d',
      created_at: input.created_at ?? nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into companies (${COLS.companies}) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
        [row.id, row.name, row.slug, row.visibility, row.retention_policy, row.created_at])
      return row
    }
    getStore().companies = [...getStore().companies, row]
    bumpRevision()
    return row
  },
  async update(ctx: RlsContext, id: string, patch: Partial<Pick<Company, 'name' | 'visibility' | 'retention_policy'>>): Promise<Company | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update companies set name = coalesce($2, name), visibility = coalesce($3, visibility), retention_policy = coalesce($4, retention_policy) where id = $1`,
        [id, patch.name ?? null, patch.visibility ?? null, patch.retention_policy ?? null])
      return companies.findById(ctx, id)
    }
    const s = getStore()
    s.companies = s.companies.map((c) => (c.id === id ? { ...c, ...patch } : c))
    bumpRevision()
    return s.companies.find((c) => c.id === id)
  }
}
