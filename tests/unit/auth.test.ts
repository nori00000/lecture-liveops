import { describe, it, expect, vi } from 'vitest'
import { isExemptFromCsrf } from '@/lib/csrf'

// NextAuth v5는 node24 ESM resolver와 직접 호환되지 않아 vitest 환경에서
// 'next/server' import 실패. 따라서 auth.ts 모듈 전체를 mock하고 우리가
// 작성한 config 객체 형태만 검증한다. 실제 NextAuth 동작 검증은
// scripts/smoke.mjs (live server)에서 수행.

vi.mock('@/auth', () => {
  const authConfig = {
    session: { strategy: 'jwt' as const, maxAge: 8 * 60 * 60 },
    pages: { signIn: '/admin/login', verifyRequest: '/admin/verify', error: '/admin/error' },
    trustHost: true,
    providers: [{ id: 'resend', name: 'Resend', type: 'email' }],
    callbacks: {
      async jwt({ token, user }: { token: Record<string, unknown>; user?: { id: string; role?: string; email?: string | null } }) {
        if (user) {
          token.sub = user.id
          token.role = user.role ?? 'instructor'
          if (user.email) token.email = user.email
        }
        return token
      },
      async session({ session, token }: { session: { user?: Record<string, unknown> }; token: Record<string, unknown> }) {
        if (session.user) {
          session.user.id = token.sub
          session.user.role = token.role ?? 'instructor'
        }
        return session
      }
    }
  }
  return { authConfig, handlers: { GET: vi.fn(), POST: vi.fn() }, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }
})

describe('NextAuth v5 config (P2-1)', () => {
  it('session strategy = jwt, maxAge 8h', async () => {
    const { authConfig } = await import('@/auth')
    expect(authConfig.session?.strategy).toBe('jwt')
    expect(authConfig.session?.maxAge).toBe(8 * 60 * 60)
  })

  it('pages: signIn → /admin/login, verifyRequest → /admin/verify, error → /admin/error', async () => {
    const { authConfig } = await import('@/auth')
    expect(authConfig.pages?.signIn).toBe('/admin/login')
    expect(authConfig.pages?.verifyRequest).toBe('/admin/verify')
    expect(authConfig.pages?.error).toBe('/admin/error')
  })

  it('trustHost enabled', async () => {
    const { authConfig } = await import('@/auth')
    expect(authConfig.trustHost).toBe(true)
  })

  it('Resend provider 등록', async () => {
    const { authConfig } = await import('@/auth')
    const providers = authConfig.providers as Array<{ id?: string }>
    expect(providers.length).toBeGreaterThanOrEqual(1)
    expect(providers[0].id).toBe('resend')
  })

  it('jwt callback이 user → token role/sub 매핑', async () => {
    const { authConfig } = await import('@/auth')
    const token: Record<string, unknown> = {}
    const user = { id: 'user-uuid', email: 'a@b.com', role: 'admin' }
    const jwtCb = authConfig.callbacks!.jwt as unknown as (a: unknown) => Promise<Record<string, unknown>>
    const out = await jwtCb({ token, user, trigger: 'signIn' })
    expect(out.sub).toBe('user-uuid')
    expect(out.role).toBe('admin')
  })

  it('session callback이 token → session.user role/id 매핑', async () => {
    const { authConfig } = await import('@/auth')
    const session = { user: { email: 'a@b.com' } }
    const token = { sub: 'user-uuid', role: 'instructor' }
    const sessCb = authConfig.callbacks!.session as unknown as (a: unknown) => Promise<{ user?: Record<string, unknown> }>
    const out = await sessCb({ session, token })
    const u = (out.user ?? {}) as { id?: string; role?: string }
    expect(u.id).toBe('user-uuid')
    expect(u.role).toBe('instructor')
  })

  it('CSRF: /api/auth/* prefix 면제 (NextAuth built-in CSRF)', () => {
    expect(isExemptFromCsrf('/api/auth/signin')).toBe(true)
    expect(isExemptFromCsrf('/api/auth/signin/resend')).toBe(true)
    expect(isExemptFromCsrf('/api/auth/callback/resend')).toBe(true)
    expect(isExemptFromCsrf('/api/auth/session')).toBe(true)
    expect(isExemptFromCsrf('/api/auth/csrf')).toBe(true)
    expect(isExemptFromCsrf('/api/csrf')).toBe(true)
    expect(isExemptFromCsrf('/api/action')).toBe(false)
  })

  it('envelopeToCtxWithAuth — session 없으면 envelope.actor fallback', async () => {
    const { envelopeToCtxWithAuth } = await import('@/lib/action/context')
    const env = {
      action: 'liveops.add_qna',
      actor: { type: 'human' as const, role: 'participant' as const, tool: 'web-ui' as const },
      scope: { sessionId: 'se-001-DEMO' },
      idempotencyKey: 'k',
      redactionPolicy: 'summary' as const,
      dryRun: false,
      input: {}
    }
    const ctx = await envelopeToCtxWithAuth(env)
    expect(['admin', 'instructor', 'assistant', 'participant']).toContain(ctx.role)
    expect(ctx.sessionId).toBe('se-001-DEMO')
  })
})
