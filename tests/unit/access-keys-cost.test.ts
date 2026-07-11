import bcrypt from 'bcryptjs'
import { describe, expect, it } from 'vitest'
import { accessKeyHashCost } from '@/lib/db/repo/accessKeys'

describe('access key bcrypt cost', () => {
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
})
