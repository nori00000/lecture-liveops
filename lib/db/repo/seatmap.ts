// Lecture LiveOps — 좌석 신호등 보드 repo (seat_layouts + seat_marks)
// signals.ts와 동일한 dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { SeatLayout, SeatLayoutConfig, SeatMark } from '../schema'

type Row = Record<string, unknown>

function toLayout(r: Row): SeatLayout {
  const raw = typeof r.layout === 'string' ? JSON.parse(r.layout) : r.layout
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    name: String(r.name ?? ''),
    layout: (raw as SeatLayoutConfig) ?? { zones: [], tables: [] },
    created_at: isoOrString(r.created_at),
    updated_at: isoOrString(r.updated_at)
  }
}

function toMark(r: Row): SeatMark {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    seat_key: String(r.seat_key),
    status: (r.status as SeatMark['status']) ?? 'none',
    reason: String(r.reason ?? ''),
    memo: String(r.memo ?? ''),
    updated_by: String(r.updated_by ?? ''),
    updated_at: isoOrString(r.updated_at)
  }
}

export const seatLayouts = {
  // 세션당 active 1개
  async getBySession(ctx: RlsContext, sessionId: string): Promise<SeatLayout | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.seat_layouts} from seat_layouts where session_id = $1`, [sessionId])
      return r ? toLayout(r) : undefined
    }
    return getStore().seat_layouts.find((l) => l.session_id === sessionId)
  },
  async upsert(ctx: RlsContext, input: { session_id: string; name: string; layout: SeatLayoutConfig }): Promise<SeatLayout> {
    if (isNeonEnabled()) {
      const id = newId('sl')
      const now = nowIso()
      await query(ctx, `insert into seat_layouts (${COLS.seat_layouts}) values ($1,$2,$3,$4,$5,$6) on conflict (session_id) do update set name = excluded.name, layout = excluded.layout, updated_at = excluded.updated_at`,
        [id, input.session_id, input.name, JSON.stringify(input.layout), now, now])
      const r = await queryOne(ctx, `select ${COLS.seat_layouts} from seat_layouts where session_id = $1`, [input.session_id])
      return toLayout(r!)
    }
    const s = getStore()
    const existing = s.seat_layouts.find((l) => l.session_id === input.session_id)
    if (existing) {
      s.seat_layouts = s.seat_layouts.map((l) =>
        l.id === existing.id ? { ...l, name: input.name, layout: input.layout, updated_at: nowIso() } : l
      )
      bumpRevision()
      return s.seat_layouts.find((l) => l.id === existing.id)!
    }
    const row: SeatLayout = {
      id: newId('sl'),
      session_id: input.session_id,
      name: input.name,
      layout: input.layout,
      created_at: nowIso(),
      updated_at: nowIso()
    }
    s.seat_layouts = [...s.seat_layouts, row]
    bumpRevision()
    return row
  }
}

export const seatMarks = {
  async list(ctx: RlsContext, sessionId: string): Promise<SeatMark[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.seat_marks} from seat_marks where session_id = $1 order by seat_key`, [sessionId])
      return rows.map(toMark)
    }
    return getStore()
      .seat_marks.filter((m) => m.session_id === sessionId)
      .slice()
      .sort((a, b) => a.seat_key.localeCompare(b.seat_key))
  },
  // 세션의 모든 마크 일괄 삭제 (전체 초기화). 삭제 행 수 반환.
  async clearAll(ctx: RlsContext, sessionId: string): Promise<number> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `delete from seat_marks where session_id = $1 returning id`, [sessionId])
      return rows.length
    }
    const s = getStore()
    const before = s.seat_marks.length
    s.seat_marks = s.seat_marks.filter((m) => m.session_id !== sessionId)
    bumpRevision()
    return before - s.seat_marks.length
  },

  // unique(session_id, seat_key) upsert
  async upsert(ctx: RlsContext, input: { session_id: string; seat_key: string; status: SeatMark['status']; reason?: string; memo?: string; updated_by?: string }): Promise<SeatMark> {
    if (isNeonEnabled()) {
      const id = newId('sm')
      const updated_at = nowIso()
      await query(ctx, `insert into seat_marks (${COLS.seat_marks}) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (session_id, seat_key) do update set status = excluded.status, reason = excluded.reason, memo = excluded.memo, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [id, input.session_id, input.seat_key, input.status, input.reason ?? '', input.memo ?? '', input.updated_by ?? '', updated_at])
      const r = await queryOne(ctx, `select ${COLS.seat_marks} from seat_marks where session_id = $1 and seat_key = $2`,
        [input.session_id, input.seat_key])
      return toMark(r!)
    }
    const s = getStore()
    const existing = s.seat_marks.find((m) => m.session_id === input.session_id && m.seat_key === input.seat_key)
    if (existing) {
      s.seat_marks = s.seat_marks.map((m) =>
        m.id === existing.id
          ? { ...m, status: input.status, reason: input.reason ?? '', memo: input.memo ?? '', updated_by: input.updated_by ?? '', updated_at: nowIso() }
          : m
      )
      bumpRevision()
      return s.seat_marks.find((m) => m.id === existing.id)!
    }
    const row: SeatMark = {
      id: newId('sm'),
      session_id: input.session_id,
      seat_key: input.seat_key,
      status: input.status,
      reason: input.reason ?? '',
      memo: input.memo ?? '',
      updated_by: input.updated_by ?? '',
      updated_at: nowIso()
    }
    s.seat_marks = [...s.seat_marks, row]
    bumpRevision()
    return row
  }
}
