import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { todayKo } from '@/lib/util/koreanTime'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, dateOnly, type RlsContext, adminContext } from '../neonHelpers'
import type { Session } from '../schema'

type Row = Record<string, unknown>
function toSession(r: Row): Session {
  return {
    id: String(r.id),
    company_id: String(r.company_id),
    course_id: String(r.course_id),
    date: dateOnly(r.date),
    title: String(r.title),
    venue: String(r.venue ?? ''),
    mode: (r.mode as Session['mode']) ?? 'prep',
    private_by_default: r.private_by_default === false ? false : true,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: isoOrString(r.created_at)
  }
}

export const sessions = {
  async list(ctx: RlsContext): Promise<Session[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.sessions} from sessions order by date desc, created_at desc`)
      return rows.map(toSession)
    }
    return [...getStore().sessions]
  },
  async findById(ctx: RlsContext, id: string): Promise<Session | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.sessions} from sessions where id = $1`, [id])
      return r ? toSession(r) : undefined
    }
    return getStore().sessions.find((s) => s.id === id)
  },
  async findByDate(ctx: RlsContext, date: string): Promise<Session[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.sessions} from sessions where date = $1`, [date])
      return rows.map(toSession)
    }
    return getStore().sessions.filter((s) => s.date === date)
  },
  async findByCompany(ctx: RlsContext, companyId: string): Promise<Session[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.sessions} from sessions where company_id = $1 order by date desc`, [companyId])
      return rows.map(toSession)
    }
    return getStore().sessions.filter((s) => s.company_id === companyId)
  },
  // 상황판(/today) 세션 선택. 우선순위:
  //  1) 오늘 세션  2) 가장 가까운 예정(미래) 세션  3) 최근 진행(과거, live 우선)  4) 아무거나
  // 2)가 핵심: 예정 세션을 상황판에 노출해 "만든 세션이 안 보인다"를 막고,
  // 과거 날짜의 live 세션이 fallback 을 상시 점유(상황판 오염)하지 못하게 3)으로 격리한다.
  async getToday(ctx: RlsContext = adminContext()): Promise<Session | undefined> {
    const today = todayKo()
    if (isNeonEnabled()) {
      const exact = await queryOne(ctx, `select ${COLS.sessions} from sessions where date = $1 and mode != 'archived' order by created_at desc limit 1`, [today])
      if (exact) return toSession(exact)
      const upcoming = await queryOne(ctx, `select ${COLS.sessions} from sessions where date > $1 and mode != 'archived' order by date asc, created_at desc limit 1`, [today])
      if (upcoming) return toSession(upcoming)
      const recent = await queryOne(ctx, `select ${COLS.sessions} from sessions where date < $1 and mode != 'archived' order by (mode = 'live') desc, date desc limit 1`, [today])
      if (recent) return toSession(recent)
      const any = await queryOne(ctx, `select ${COLS.sessions} from sessions order by date desc, created_at desc limit 1`)
      return any ? toSession(any) : undefined
    }
    const active = getStore().sessions.filter((x) => x.mode !== 'archived')
    const exact = active.find((x) => x.date === today)
    if (exact) return exact
    const upcoming = active.filter((x) => x.date > today).sort((a, b) => a.date.localeCompare(b.date))[0]
    if (upcoming) return upcoming
    const recent = active
      .filter((x) => x.date < today)
      .sort((a, b) => Number(b.mode === 'live') - Number(a.mode === 'live') || b.date.localeCompare(a.date))[0]
    return recent ?? getStore().sessions[0]
  },
  async insert(ctx: RlsContext, input: Omit<Session, 'id' | 'created_at'> & Partial<Pick<Session, 'id' | 'created_at'>>): Promise<Session> {
    const row: Session = {
      id: input.id ?? newId('se'),
      company_id: input.company_id,
      course_id: input.course_id,
      date: input.date,
      title: input.title,
      venue: input.venue ?? '',
      mode: input.mode ?? 'prep',
      private_by_default: input.private_by_default ?? true,
      metadata: input.metadata ?? {},
      created_at: input.created_at ?? nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into sessions (${COLS.sessions}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (id) do nothing`,
        [row.id, row.company_id, row.course_id, row.date, row.title, row.venue, row.mode, row.private_by_default, JSON.stringify(row.metadata), row.created_at])
      return row
    }
    getStore().sessions = [...getStore().sessions, row]
    bumpRevision()
    return row
  },
  async updateMode(ctx: RlsContext, id: string, mode: Session['mode']): Promise<Session | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update sessions set mode = $2 where id = $1`, [id, mode])
      return sessions.findById(ctx, id)
    }
    const s = getStore()
    s.sessions = s.sessions.map((x) => (x.id === id ? { ...x, mode } : x))
    bumpRevision()
    return s.sessions.find((x) => x.id === id)
  },
  async updateMetadata(ctx: RlsContext, id: string, metadata: Record<string, unknown>): Promise<Session | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update sessions set metadata = $2 where id = $1`, [id, JSON.stringify(metadata)])
      return sessions.findById(ctx, id)
    }
    const s = getStore()
    s.sessions = s.sessions.map((x) => (x.id === id ? { ...x, metadata } : x))
    bumpRevision()
    return s.sessions.find((x) => x.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from sessions where id = $1`, [id])
      return
    }
    const s = getStore()
    s.sessions = s.sessions.filter((x) => x.id !== id)
    bumpRevision()
  }
}
