import { describe, it, expect } from 'vitest'
import { isNeonEnabled, isAnonAvailable } from '@/lib/db/neon'

describe('Neon adapter dual config', () => {
  it('isNeonEnabled reflects DATABASE_URL presence', () => {
    const hasOwner = Boolean(process.env.DATABASE_URL?.startsWith('postgres'))
    expect(isNeonEnabled()).toBe(hasOwner)
  })

  it('isAnonAvailable reflects DATABASE_URL_ANON presence', () => {
    const hasAnon = Boolean(process.env.DATABASE_URL_ANON?.startsWith('postgres'))
    expect(isAnonAvailable()).toBe(hasAnon)
  })

  it('DATABASE_URL never accidentally equals DATABASE_URL_ANON', () => {
    if (process.env.DATABASE_URL && process.env.DATABASE_URL_ANON) {
      expect(process.env.DATABASE_URL).not.toBe(process.env.DATABASE_URL_ANON)
    }
  })
})
