// Lecture LiveOps — 좌석 배치도 템플릿 repo (seat_layout_templates)
// dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { SeatLayoutTemplate, SeatLayoutConfig } from '../schema'

type Row = Record<string, unknown>

function toTemplate(r: Row): SeatLayoutTemplate {
  const raw = typeof r.layout === 'string' ? JSON.parse(r.layout) : r.layout
  return {
    id: String(r.id),
    slug: String(r.slug),
    name: String(r.name ?? ''),
    description: String(r.description ?? ''),
    layout: (raw as SeatLayoutConfig) ?? { zones: [], tables: [] },
    created_at: isoOrString(r.created_at),
    updated_at: isoOrString(r.updated_at)
  }
}

export const seatLayoutTemplates = {
  async list(ctx: RlsContext): Promise<SeatLayoutTemplate[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.seat_layout_templates} from seat_layout_templates order by slug asc`)
      return rows.map(toTemplate)
    }
    return [...getStore().seat_layout_templates].sort((a, b) => a.slug.localeCompare(b.slug))
  },

  async findById(ctx: RlsContext, id: string): Promise<SeatLayoutTemplate | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.seat_layout_templates} from seat_layout_templates where id = $1`, [id])
      return r ? toTemplate(r) : undefined
    }
    return getStore().seat_layout_templates.find((t) => t.id === id)
  },

  async upsert(ctx: RlsContext, input: { slug: string; name: string; description?: string; layout: SeatLayoutConfig }): Promise<SeatLayoutTemplate> {
    const desc = input.description ?? ''
    if (isNeonEnabled()) {
      const id = newId('slt')
      const now = nowIso()
      await query(ctx, `insert into seat_layout_templates (${COLS.seat_layout_templates}) values ($1,$2,$3,$4,$5,$6,$7) on conflict (slug) do update set name = excluded.name, description = excluded.description, layout = excluded.layout, updated_at = excluded.updated_at`,
        [id, input.slug, input.name, desc, JSON.stringify(input.layout), now, now])
      const r = await queryOne(ctx, `select ${COLS.seat_layout_templates} from seat_layout_templates where slug = $1`, [input.slug])
      return toTemplate(r!)
    }
    const s = getStore()
    const existing = s.seat_layout_templates.find((t) => t.slug === input.slug)
    const now = nowIso()
    if (existing) {
      s.seat_layout_templates = s.seat_layout_templates.map((t) =>
        t.id === existing.id ? { ...t, name: input.name, description: desc, layout: input.layout, updated_at: now } : t
      )
      const res = s.seat_layout_templates.find((t) => t.id === existing.id)!
      bumpRevision()
      return { ...res }
    } else {
      const newTpl: SeatLayoutTemplate = {
        id: newId('slt'),
        slug: input.slug,
        name: input.name,
        description: desc,
        layout: input.layout,
        created_at: now,
        updated_at: now
      }
      s.seat_layout_templates.push(newTpl)
      bumpRevision()
      return { ...newTpl }
    }
  }
}
