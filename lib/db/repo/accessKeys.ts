import bcrypt from 'bcryptjs'
import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext, adminContext } from '../neonHelpers'
import type { AccessKey, Role } from '../schema'

const DEV_BCRYPT_COST = 10
const PROD_BCRYPT_COST = 12

export function accessKeyHashCost(env = process.env.NODE_ENV) {
  return env === 'production' ? PROD_BCRYPT_COST : DEV_BCRYPT_COST
}

type Row = Record<string, unknown>
function toAccessKey(r: Row): AccessKey {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    role: (r.role as Role) ?? 'participant',
    key_hash: String(r.key_hash),
    expires_at: isoOrString(r.expires_at),
    revoked_at: r.revoked_at ? isoOrString(r.revoked_at) : null,
    scope: (r.scope as Record<string, unknown>) ?? {}
  }
}

export const accessKeys = {
  async list(ctx: RlsContext, sessionId?: string): Promise<AccessKey[]> {
    if (isNeonEnabled()) {
      const rows = sessionId
        ? await query(ctx, `select ${COLS.access_keys} from access_keys where session_id = $1`, [sessionId])
        : await query(ctx, `select ${COLS.access_keys} from access_keys`)
      return rows.map(toAccessKey)
    }
    const all = [...getStore().access_keys]
    return sessionId ? all.filter((k) => k.session_id === sessionId) : all
  },
  async listSafe(ctx: RlsContext, sessionId: string): Promise<Array<Omit<AccessKey, 'key_hash'> & { has_hash: boolean }>> {
    const all = await accessKeys.list(ctx, sessionId)
    return all.map(({ key_hash, ...rest }) => ({ ...rest, has_hash: Boolean(key_hash) }))
  },
  async issue(ctx: RlsContext, input: { session_id: string; role: Role; expires_at: string; rawKey: string }): Promise<AccessKey> {
    const key_hash = await bcrypt.hash(input.rawKey, accessKeyHashCost())
    const row: AccessKey = {
      id: newId('ak'),
      session_id: input.session_id,
      role: input.role,
      key_hash,
      expires_at: input.expires_at,
      revoked_at: null,
      scope: {}
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into access_keys (${COLS.access_keys}) values ($1,$2,$3,$4,$5,$6,$7)`,
        [row.id, row.session_id, row.role, row.key_hash, row.expires_at, row.revoked_at, JSON.stringify(row.scope)])
      return row
    }
    getStore().access_keys = [...getStore().access_keys, row]
    bumpRevision()
    return row
  },
  // verify는 raw key 비교 위해 전체 스캔 — server-only, admin context 사용
  async verify(rawKey: string): Promise<AccessKey | null> {
    if (!rawKey) return null
    const now = new Date().toISOString()
    const all = await accessKeys.list(adminContext())
    for (const k of all) {
      if (k.revoked_at) continue
      if (k.expires_at < now) continue
      if (k.key_hash.startsWith('demo-hash-')) {
        if (k.key_hash === 'demo-hash-' + rawKey) return k
        if (k.key_hash.endsWith(rawKey)) return k
      } else {
        try {
          if (await bcrypt.compare(rawKey, k.key_hash)) return k
        } catch {
          // ignore
        }
      }
    }
    return null
  },
  async revoke(ctx: RlsContext, id: string): Promise<AccessKey | undefined> {
    if (isNeonEnabled()) {
      await query(ctx, `update access_keys set revoked_at = $2 where id = $1`, [id, nowIso()])
      const list = await query(ctx, `select ${COLS.access_keys} from access_keys where id = $1`, [id])
      return list[0] ? toAccessKey(list[0]) : undefined
    }
    const s = getStore()
    s.access_keys = s.access_keys.map((k) => (k.id === id ? { ...k, revoked_at: nowIso() } : k))
    bumpRevision()
    return s.access_keys.find((k) => k.id === id)
  },
  async delete(ctx: RlsContext, id: string): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from access_keys where id = $1`, [id])
      return
    }
    const s = getStore()
    s.access_keys = s.access_keys.filter((k) => k.id !== id)
    bumpRevision()
  }
}
