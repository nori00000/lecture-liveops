import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { assertProductionDbEnabled, isFixture } from '../client'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext, adminContext } from '../neonHelpers'
import type { AccessKey, Role } from '../schema'

const DEV_BCRYPT_COST = 10
const PROD_BCRYPT_COST = 12
const PREFIX_BYTES = 6
const PREFIX_LENGTH = 8
const PREFIXED_KEY_RE = /^[A-Za-z0-9_-]{8}\..+$/
const DUMMY_BCRYPT_HASH = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8w7Y3v1Q2efgA9GN6WEuJ8V1P8aL6u'

export function accessKeyHashCost(env = process.env.NODE_ENV) {
  return env === 'production' ? PROD_BCRYPT_COST : DEV_BCRYPT_COST
}

export function generateAccessKeyPrefix(): string {
  return randomBytes(PREFIX_BYTES).toString('base64url').slice(0, PREFIX_LENGTH)
}

export function withAccessKeyPrefix(rawKey: string, prefix = generateAccessKeyPrefix()): string {
  return PREFIXED_KEY_RE.test(rawKey) ? rawKey : `${prefix}.${rawKey}`
}

function accessKeyPrefix(rawKey: string): string | null {
  return PREFIXED_KEY_RE.test(rawKey) ? rawKey.slice(0, PREFIX_LENGTH) : null
}

type Row = Record<string, unknown>
type AccessKeyWithPrefix = AccessKey & { key_prefix?: string | null }
type IssuedAccessKey = AccessKeyWithPrefix & { raw_key: string }

function toAccessKey(r: Row): AccessKeyWithPrefix {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    role: (r.role as Role) ?? 'participant',
    key_hash: String(r.key_hash),
    expires_at: isoOrString(r.expires_at),
    revoked_at: r.revoked_at ? isoOrString(r.revoked_at) : null,
    scope: (r.scope as Record<string, unknown>) ?? {},
    key_prefix: typeof r.key_prefix === 'string' ? r.key_prefix : null
  }
}

function active(k: AccessKey, now: string): boolean {
  return !k.revoked_at && k.expires_at >= now
}

async function matchesRawKey(rawKey: string, k: AccessKey): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && isFixture() && k.key_hash.startsWith('demo-hash-')) {
    return k.key_hash === 'demo-hash-' + rawKey || k.key_hash.endsWith(rawKey)
  }
  try {
    return await bcrypt.compare(rawKey, k.key_hash)
  } catch {
    return false
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
    assertProductionDbEnabled()
    const all = [...getStore().access_keys]
    return sessionId ? all.filter((k) => k.session_id === sessionId) : all
  },
  async listSafe(ctx: RlsContext, sessionId: string): Promise<Array<Omit<AccessKey, 'key_hash'> & { has_hash: boolean }>> {
    const all = await accessKeys.list(ctx, sessionId)
    return all.map(({ key_hash, ...rest }) => ({ ...rest, has_hash: Boolean(key_hash) }))
  },
  async issue(ctx: RlsContext, input: { session_id: string; role: Role; expires_at: string; rawKey: string }): Promise<IssuedAccessKey> {
    const raw_key = withAccessKeyPrefix(input.rawKey)
    const key_prefix = accessKeyPrefix(raw_key)
    const key_hash = await bcrypt.hash(raw_key, accessKeyHashCost())
    const row: IssuedAccessKey = {
      id: newId('ak'),
      session_id: input.session_id,
      role: input.role,
      key_hash,
      expires_at: input.expires_at,
      revoked_at: null,
      scope: {},
      key_prefix,
      raw_key
    }
    const { raw_key: _rawKey, ...storedRow } = row
    if (isNeonEnabled()) {
      await query(ctx, `insert into access_keys (id, session_id, role, key_hash, expires_at, revoked_at, scope, key_prefix) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [row.id, row.session_id, row.role, row.key_hash, row.expires_at, row.revoked_at, JSON.stringify(row.scope), row.key_prefix])
      return row
    }
    assertProductionDbEnabled()
    void _rawKey
    getStore().access_keys = [...getStore().access_keys, storedRow]
    bumpRevision()
    return row
  },
  // server-only, admin context 사용. Prefix가 있으면 key_prefix 인덱스로 먼저 조회한다.
  async verify(rawKey: string): Promise<AccessKey | null> {
    if (!rawKey) return null
    const now = new Date().toISOString()
    const prefix = accessKeyPrefix(rawKey)
    const neonEnabled = isNeonEnabled()
    if (!neonEnabled) assertProductionDbEnabled()

    if (prefix) {
      const candidates = neonEnabled
        ? await query<AccessKeyWithPrefix>(adminContext(), `select ${COLS.access_keys}, key_prefix from access_keys where key_prefix = $1`, [prefix])
        : (getStore().access_keys as AccessKeyWithPrefix[]).filter((k) => k.key_prefix === prefix)
      for (const k of candidates) {
        if (active(k, now) && await matchesRawKey(rawKey, k)) return k
      }
      if (candidates.length === 0) {
        await bcrypt.compare(rawKey, DUMMY_BCRYPT_HASH)
      }
      return null
    }

    const legacy = neonEnabled
      ? await query<AccessKeyWithPrefix>(adminContext(), `select ${COLS.access_keys}, key_prefix from access_keys where key_prefix is null`, [])
      : (getStore().access_keys as AccessKeyWithPrefix[]).filter((k) => !k.key_prefix)
    for (const k of legacy) {
      if (active(k, now) && await matchesRawKey(rawKey, k)) {
        return k
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
    assertProductionDbEnabled()
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
    assertProductionDbEnabled()
    const s = getStore()
    s.access_keys = s.access_keys.filter((k) => k.id !== id)
    bumpRevision()
  }
}
