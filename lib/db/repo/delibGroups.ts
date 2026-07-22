// Lecture LiveOps — 숙의 그룹/라운드 repo (workshop_groups + group_memberships + workshop_rounds)
// 워크숍 구조(structure) 담당. dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, withTxn, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { WorkshopGroup, GroupMembership, WorkshopRound } from '../schema'

type Row = Record<string, unknown>

function toGroup(r: Row): WorkshopGroup {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    label: String(r.label ?? ''),
    topic: String(r.topic ?? '')
  }
}

function toMembership(r: Row): GroupMembership {
  return {
    id: String(r.id),
    participant_id: String(r.participant_id),
    group_id: String(r.group_id),
    created_at: isoOrString(r.created_at)
  }
}

function toRound(r: Row): WorkshopRound {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    round_index: Number(r.round_index),
    title: String(r.title ?? ''),
    mode: (r.mode as WorkshopRound['mode']) ?? 'plenary',
    status: (r.status as WorkshopRound['status']) ?? 'pending',
    created_at: isoOrString(r.created_at)
  }
}

export const delibGroups = {
  async list(ctx: RlsContext, sessionId: string): Promise<WorkshopGroup[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.workshop_groups} from workshop_groups where session_id = $1 order by label asc`, [sessionId])
      return rows.map(toGroup)
    }
    return getStore().workshop_groups.filter((g) => g.session_id === sessionId)
  },
  async findById(ctx: RlsContext, id: string): Promise<WorkshopGroup | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.workshop_groups} from workshop_groups where id = $1`, [id])
      return r ? toGroup(r) : undefined
    }
    return getStore().workshop_groups.find((g) => g.id === id)
  },
  // groupId 지정 시 update, 없으면 신규 생성
  async upsert(ctx: RlsContext, input: { id?: string; session_id: string; label: string; topic?: string }): Promise<WorkshopGroup> {
    const topic = input.topic ?? ''
    if (isNeonEnabled()) {
      if (input.id) {
        await query(ctx, `insert into workshop_groups (${COLS.workshop_groups}) values ($1,$2,$3,$4) on conflict (id) do update set label = excluded.label, topic = excluded.topic, session_id = excluded.session_id`,
          [input.id, input.session_id, input.label, topic])
        const r = await queryOne(ctx, `select ${COLS.workshop_groups} from workshop_groups where id = $1`, [input.id])
        return toGroup(r!)
      }
      const id = newId('wg')
      await query(ctx, `insert into workshop_groups (${COLS.workshop_groups}) values ($1,$2,$3,$4)`, [id, input.session_id, input.label, topic])
      return { id, session_id: input.session_id, label: input.label, topic }
    }
    const s = getStore()
    if (input.id) {
      const existing = s.workshop_groups.find((g) => g.id === input.id)
      if (existing) {
        s.workshop_groups = s.workshop_groups.map((g) => (g.id === input.id ? { ...g, label: input.label, topic } : g))
        bumpRevision()
        return s.workshop_groups.find((g) => g.id === input.id)!
      }
    }
    const row: WorkshopGroup = { id: input.id ?? newId('wg'), session_id: input.session_id, label: input.label, topic }
    s.workshop_groups = [...s.workshop_groups, row]
    bumpRevision()
    return row
  },
  // 참가자를 그룹에 배정 — 1인 1그룹(unique(participant_id)) upsert 단일 쿼리 (M-3).
  // 동시 배정 레이스는 unique 제약이, 세션 경계는 delib_membership_guard trigger 가 강제.
  async assignParticipant(ctx: RlsContext, participantId: string, groupId: string): Promise<GroupMembership> {
    const id = newId('gm')
    const now = nowIso()
    if (isNeonEnabled()) {
      await query(ctx, `insert into group_memberships (${COLS.group_memberships}) values ($1,$2,$3,$4)
        on conflict (participant_id) do update set group_id = excluded.group_id, created_at = excluded.created_at`,
        [id, participantId, groupId, now])
      return { id, participant_id: participantId, group_id: groupId, created_at: now }
    }
    const s = getStore()
    // fixture 도 trigger 를 흉내내 세션 경계를 검증한다 (이원화 일치).
    const p = s.participants.find((x) => x.id === participantId)
    const g = s.workshop_groups.find((x) => x.id === groupId)
    if (!p || !g || p.session_id !== g.session_id) throw new Error('delib: membership session mismatch')
    const existing = s.group_memberships.find((m) => m.participant_id === participantId)
    if (existing) {
      s.group_memberships = s.group_memberships.map((m) => (m.participant_id === participantId ? { ...m, group_id: groupId, created_at: now } : m))
      bumpRevision()
      return s.group_memberships.find((m) => m.participant_id === participantId)!
    }
    const row: GroupMembership = { id, participant_id: participantId, group_id: groupId, created_at: now }
    s.group_memberships = [...s.group_memberships, row]
    bumpRevision()
    return row
  },
  async listMemberships(ctx: RlsContext, groupId: string): Promise<GroupMembership[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.group_memberships} from group_memberships where group_id = $1`, [groupId])
      return rows.map(toMembership)
    }
    return getStore().group_memberships.filter((m) => m.group_id === groupId)
  },
  // participant 의 현재 그룹 조회 — /p/enter 가 쿠키에 groupId 를 심을 때 사용.
  async findMembershipByParticipant(ctx: RlsContext, participantId: string): Promise<GroupMembership | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.group_memberships} from group_memberships where participant_id = $1`, [participantId])
      return r ? toMembership(r) : undefined
    }
    return getStore().group_memberships.find((m) => m.participant_id === participantId)
  }
}

export const delibRounds = {
  async list(ctx: RlsContext, sessionId: string): Promise<WorkshopRound[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.workshop_rounds} from workshop_rounds where session_id = $1 order by round_index asc`, [sessionId])
      return rows.map(toRound)
    }
    return getStore().workshop_rounds.filter((r) => r.session_id === sessionId).slice().sort((a, b) => a.round_index - b.round_index)
  },
  async findById(ctx: RlsContext, id: string): Promise<WorkshopRound | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.workshop_rounds} from workshop_rounds where id = $1`, [id])
      return r ? toRound(r) : undefined
    }
    return getStore().workshop_rounds.find((r) => r.id === id)
  },
  // 라운드 생성 (unique(session_id, round_index))
  async create(ctx: RlsContext, input: { session_id: string; round_index: number; title?: string; mode?: WorkshopRound['mode']; status?: WorkshopRound['status'] }): Promise<WorkshopRound> {
    const row: WorkshopRound = {
      id: newId('wr'),
      session_id: input.session_id,
      round_index: input.round_index,
      title: input.title ?? '',
      mode: input.mode ?? 'plenary',
      status: input.status ?? 'pending',
      created_at: nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into workshop_rounds (${COLS.workshop_rounds}) values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.session_id, row.round_index, row.title, row.mode, row.status, row.created_at])
      return row
    }
    // fixture 도 unique(session_id, round_index) 를 흉내내 동일 에러를 던진다 (M-10 / 이원화 일치).
    if (getStore().workshop_rounds.some((r) => r.session_id === row.session_id && r.round_index === row.round_index)) {
      throw new Error('duplicate key value violates unique constraint "workshop_rounds_session_index_unique"')
    }
    getStore().workshop_rounds = [...getStore().workshop_rounds, row]
    bumpRevision()
    return row
  },
  // 라운드 시작 — 원자 연산 (M-4). 같은 세션의 기존 active 를 closed 로 내리고 새 라운드를 active 로 삽입.
  // partial unique index(status='active') 충돌을 피하려 반드시 close → insert 순서. 세션당 active 1개 보장.
  async startRound(ctx: RlsContext, input: { session_id: string; round_index: number; title?: string; mode?: WorkshopRound['mode'] }): Promise<WorkshopRound> {
    const row: WorkshopRound = {
      id: newId('wr'),
      session_id: input.session_id,
      round_index: input.round_index,
      title: input.title ?? '',
      mode: input.mode ?? 'plenary',
      status: 'active',
      created_at: nowIso()
    }
    if (isNeonEnabled()) {
      await withTxn(ctx, (sql) => [
        sql`update workshop_rounds set status = 'closed' where session_id = ${row.session_id} and status = 'active'`,
        sql`insert into workshop_rounds (id, session_id, round_index, title, mode, status, created_at)
            values (${row.id}, ${row.session_id}, ${row.round_index}, ${row.title}, ${row.mode}, ${row.status}, ${row.created_at})`
      ])
      return row
    }
    const s = getStore()
    if (s.workshop_rounds.some((r) => r.session_id === row.session_id && r.round_index === row.round_index)) {
      throw new Error('duplicate key value violates unique constraint "workshop_rounds_session_index_unique"')
    }
    s.workshop_rounds = s.workshop_rounds.map((r) => (r.session_id === row.session_id && r.status === 'active' ? { ...r, status: 'closed' } : r))
    s.workshop_rounds = [...s.workshop_rounds, row]
    bumpRevision()
    return row
  },
  // 라운드 시작 — 대상 라운드 active, 같은 세션의 다른 active 라운드는 closed 로 전환
  async activate(ctx: RlsContext, roundId: string): Promise<WorkshopRound | undefined> {
    if (isNeonEnabled()) {
      const target = await delibRounds.findById(ctx, roundId)
      if (!target) return undefined
      await query(ctx, `update workshop_rounds set status = 'closed' where session_id = $1 and status = 'active' and id <> $2`, [target.session_id, roundId])
      await query(ctx, `update workshop_rounds set status = 'active' where id = $1`, [roundId])
      return delibRounds.findById(ctx, roundId)
    }
    const s = getStore()
    const target = s.workshop_rounds.find((r) => r.id === roundId)
    if (!target) return undefined
    s.workshop_rounds = s.workshop_rounds.map((r) => {
      if (r.id === roundId) return { ...r, status: 'active' }
      if (r.session_id === target.session_id && r.status === 'active') return { ...r, status: 'closed' }
      return r
    })
    bumpRevision()
    return s.workshop_rounds.find((r) => r.id === roundId)
  }
}
