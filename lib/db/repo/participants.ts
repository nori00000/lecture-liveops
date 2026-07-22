// Lecture LiveOps — 숙의 참가자 repo (participants)
// qna.ts와 동일한 dual-mode 패턴: Neon query / fixture getStore()

import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { Participant } from '../schema'

type Row = Record<string, unknown>

function toParticipant(r: Row): Participant {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    display_alias: String(r.display_alias ?? ''),
    anon_handle: String(r.anon_handle ?? ''),
    access_key_id: r.access_key_id == null ? null : String(r.access_key_id),
    created_at: isoOrString(r.created_at)
  }
}

export const participants = {
  async list(ctx: RlsContext, sessionId: string): Promise<Participant[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.participants} from participants where session_id = $1 order by created_at asc`, [sessionId])
      return rows.map(toParticipant)
    }
    return getStore().participants.filter((p) => p.session_id === sessionId)
  },
  async findById(ctx: RlsContext, id: string): Promise<Participant | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.participants} from participants where id = $1`, [id])
      return r ? toParticipant(r) : undefined
    }
    return getStore().participants.find((p) => p.id === id)
  },
  // access_key 당 participant 1개 (C-B). /p/enter 가 재입장 시 기존 row 를 재사용하기 위해 사용.
  async findByAccessKeyId(ctx: RlsContext, accessKeyId: string): Promise<Participant | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.participants} from participants where access_key_id = $1`, [accessKeyId])
      return r ? toParticipant(r) : undefined
    }
    return getStore().participants.find((p) => p.access_key_id === accessKeyId)
  },
  async register(
    ctx: RlsContext,
    input: Omit<Participant, 'id' | 'created_at'> & Partial<Pick<Participant, 'id'>>
  ): Promise<Participant> {
    const row: Participant = {
      id: input.id ?? newId('pa'),
      session_id: input.session_id,
      display_alias: input.display_alias ?? '',
      anon_handle: input.anon_handle ?? '',
      access_key_id: input.access_key_id ?? null,
      created_at: nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into participants (${COLS.participants}) values ($1,$2,$3,$4,$5,$6)`,
        [row.id, row.session_id, row.display_alias, row.anon_handle, row.access_key_id, row.created_at])
      return row
    }
    // fixture 도 partial unique index(access_key_id) 를 흉내내 동일 에러를 던진다 (C-B / 이원화 일치).
    if (row.access_key_id != null && getStore().participants.some((p) => p.access_key_id === row.access_key_id)) {
      throw new Error('duplicate key value violates unique constraint "participants_access_key_unique"')
    }
    getStore().participants = [...getStore().participants, row]
    bumpRevision()
    return row
  }
}
