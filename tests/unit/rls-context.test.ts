import { describe, it, expect } from 'vitest'
import { adminContext, type RlsContext } from '@/lib/db/neonHelpers'
import { envelopeToCtx } from '@/lib/action/context'

describe('RLS context', () => {
  it('adminContext defaults to admin role + undefined sessionId', () => {
    const ctx = adminContext()
    expect(ctx.role).toBe('admin')
    expect(ctx.sessionId).toBeUndefined()
  })

  it('adminContext respects sessionId arg', () => {
    const ctx = adminContext('se-001-DEMO')
    expect(ctx.role).toBe('admin')
    expect(ctx.sessionId).toBe('se-001-DEMO')
  })

  it('envelopeToCtx extracts role/sessionId/sub from envelope', () => {
    const env = {
      action: 'liveops.add_qna',
      actor: { type: 'human' as const, role: 'participant' as const, tool: 'web-ui' as const, userId: 'u-1' },
      scope: { sessionId: 'se-001-DEMO' },
      idempotencyKey: 'k',
      redactionPolicy: 'summary' as const,
      dryRun: false,
      input: {}
    }
    const ctx: RlsContext = envelopeToCtx(env)
    expect(ctx.role).toBe('participant')
    expect(ctx.sessionId).toBe('se-001-DEMO')
    expect(ctx.sub).toBe('u-1')
  })

  it('envelopeToCtx allows missing sessionId', () => {
    const env = {
      action: 'liveops.get_today_session',
      actor: { type: 'system' as const, role: 'admin' as const, tool: 'web-ui' as const },
      scope: {},
      idempotencyKey: 'k',
      redactionPolicy: 'summary' as const,
      dryRun: false,
      input: {}
    }
    const ctx = envelopeToCtx(env)
    expect(ctx.role).toBe('admin')
    expect(ctx.sessionId).toBeUndefined()
  })

  it('RlsContext role enum is enforced at type level (compile-time)', () => {
    // 컴파일 단계 확인 — 런타임에는 단순 truthy check
    const ctx: RlsContext = { role: 'instructor', sessionId: 'se-001-DEMO' }
    expect(['admin', 'instructor', 'assistant', 'participant']).toContain(ctx.role)
  })
})
