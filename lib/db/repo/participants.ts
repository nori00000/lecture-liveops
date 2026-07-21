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
    getStore().participants = [...getStore().participants, row]
    bumpRevision()
    return row
  }
}
