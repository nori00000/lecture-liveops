import bcrypt from 'bcryptjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accessKeyHashCost, accessKeys, withAccessKeyPrefix } from '@/lib/db/repo/accessKeys'
import { getStore, resetStore } from '@/lib/db/fixture/store'
import { adminContext } from '@/lib/db/neonHelpers'

const OLD_ENV = {
  databaseUrl: process.env.DATABASE_URL,
  databaseUrlAnon: process.env.DATABASE_URL_ANON,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnon: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

function forceFixtureMode() {
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_URL_ANON
  delete process.env.NEXT_PUBLIC_SUPABASE_URL
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}

function restoreEnv() {
  if (OLD_ENV.databaseUrl === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = OLD_ENV.databaseUrl
  if (OLD_ENV.databaseUrlAnon === undefined) delete process.env.DATABASE_URL_ANON
  else process.env.DATABASE_URL_ANON = OLD_ENV.databaseUrlAnon
  if (OLD_ENV.supabaseUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
  else process.env.NEXT_PUBLIC_SUPABASE_URL = OLD_ENV.supabaseUrl
  if (OLD_ENV.supabaseAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = OLD_ENV.supabaseAnon
}

describe('access key bcrypt cost', () => {
  beforeEach(() => {
    forceFixtureMode()
    resetStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    restoreEnv()
  })

  it('dev/test 환경은 cost 10을 유지한다', () => {
    expect(accessKeyHashCost('development')).toBe(10)
    expect(accessKeyHashCost('test')).toBe(10)
  })

  it('production 환경은 cost 12를 사용한다', () => {
    expect(accessKeyHashCost('production')).toBe(12)
  })

  it('bcrypt hash prefix에서 cost를 확인할 수 있다', async () => {
    const hash = await bcrypt.hash('sample-key', accessKeyHashCost('production'))
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
    expect(await bcrypt.compare('sample-key', hash)).toBe(true)
  })

  it('신규 키를 prefix.secret 형태로 저장하고 prefix로 검증한다', async () => {
    const issued = await accessKeys.issue(adminContext('se-001-DEMO'), {
      session_id: 'se-001-DEMO',
      role: 'participant',
      expires_at: '2026-12-31T23:59:00+09:00',
      rawKey: 'lookup-secret'
    })

    expect(issued.raw_key).toMatch(/^[A-Za-z0-9_-]{8}\.lookup-secret$/)
    expect(issued.key_prefix).toBe(issued.raw_key.slice(0, 8))

    const stored = getStore().access_keys.find((k) => k.id === issued.id) as typeof issued | undefined
    expect(stored?.key_prefix).toBe(issued.key_prefix)
    expect(stored).not.toHaveProperty('raw_key')
    expect(await accessKeys.verify(issued.raw_key)).toMatchObject({ id: issued.id })
  })

  it('이미 prefix가 붙은 신규 키는 해당 prefix 후보만 bcrypt 비교한다', async () => {
    const rawKey = withAccessKeyPrefix('secret-for-prefix', 'pref1234')
    const issued = await accessKeys.issue(adminContext('se-001-DEMO'), {
      session_id: 'se-001-DEMO',
      role: 'participant',
      expires_at: '2026-12-31T23:59:00+09:00',
      rawKey
    })
    const compareSpy = vi.spyOn(bcrypt, 'compare')

    const verified = await accessKeys.verify(rawKey)

    expect(verified?.id).toBe(issued.id)
    expect(compareSpy).toHaveBeenCalledTimes(1)
  })

  it('prefix 없는 레거시 bcrypt 키는 전수 스캔 폴백으로 검증한다', async () => {
    const legacyRaw = 'legacy-raw-key'
    const legacyHash = await bcrypt.hash(legacyRaw, accessKeyHashCost())
    getStore().access_keys = [{
      id: 'ak-legacy',
      session_id: 'se-001-DEMO',
      role: 'participant',
      key_hash: legacyHash,
      expires_at: '2026-12-31T23:59:00+09:00',
      revoked_at: null,
      scope: {}
    }]

    await expect(accessKeys.verify(legacyRaw)).resolves.toMatchObject({ id: 'ak-legacy' })
  })

  it('demo-hash 우회는 fixture 모드에서만 허용한다', async () => {
    await expect(accessKeys.verify('se-001-DEMO-part-1')).resolves.toMatchObject({ id: 'ak-004-DEMO' })

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'

    await expect(accessKeys.verify('se-001-DEMO-part-1')).resolves.toBeNull()
  })
})
