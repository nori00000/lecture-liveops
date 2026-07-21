// Lecture LiveOps — 숙의 지형 스냅샷 repo (landscape_snapshots)
// dual-mode 패턴: Neon query / fixture getStore()
// payload 는 집계 지표만 담는다 (개인 표 원자료 없음). publish 로 결과판/프로젝터 공개.

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { LandscapeSnapshot } from '../schema'

type Row = Record<string, unknown>

function toSnapshot(r: Row): LandscapeSnapshot {
  const raw = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    round_id: r.round_id == null ? null : String(r.round_id),
    computed_at: isoOrString(r.computed_at),
    payload: (raw as Record<string, unknown>) ?? {},
    published_at: r.published_at == null ? null : isoOrString(r.published_at)
  }
}

export const landscape = {
  async list(ctx: RlsContext, sessionId: string): Promise<LandscapeSnapshot[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.landscape_snapshots} from landscape_snapshots where session_id = $1 order by computed_at desc`, [sessionId])
      return rows.map(toSnapshot)
    }
    return getStore().landscape_snapshots.filter((s) => s.session_id === sessionId).slice().sort((a, b) => b.computed_at.localeCompare(a.computed_at))
  },
  async findById(ctx: RlsContext, id: string): Promise<LandscapeSnapshot | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.landscape_snapshots} from landscape_snapshots where id = $1`, [id])
      return r ? toSnapshot(r) : undefined
    }
    return getStore().landscape_snapshots.find((s) => s.id === id)
  },
  async compute(ctx: RlsContext, input: { session_id: string; round_id?: string | null; payload: Record<string, unknown> }): Promise<LandscapeSnapshot> {
    const row: LandscapeSnapshot = {
      id: newId('ls'),
      session_id: input.session_id,
      round_id: input.round_id ?? null,
      computed_at: nowIso(),
      payload: input.payload,
      published_at: null
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into landscape_snapshots (${COLS.landscape_snapshots}) values ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.session_id, row.round_id, row.computed_at, JSON.stringify(row.payload), row.published_at])
      return row
    }
    getStore().landscape_snapshots = [...getStore().landscape_snapshots, row]
    bumpRevision()
    return row
  },
  async publish(ctx: RlsContext, id: string): Promise<LandscapeSnapshot | undefined> {
    const now = nowIso()
    if (isNeonEnabled()) {
      await query(ctx, `update landscape_snapshots set published_at = $2 where id = $1`, [id, now])
      return landscape.findById(ctx, id)
    }
    const s = getStore()
    const existing = s.landscape_snapshots.find((x) => x.id === id)
    if (!existing) return undefined
    s.landscape_snapshots = s.landscape_snapshots.map((x) => (x.id === id ? { ...x, published_at: now } : x))
    bumpRevision()
    return s.landscape_snapshots.find((x) => x.id === id)
  }
}
