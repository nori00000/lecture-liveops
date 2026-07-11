// Lecture LiveOps — NextAuth v5 config (P2-1)
// admin/instructor 로그인. magic link (Resend) 또는 console fallback (dev).
// JWT claim에 role/sub 주입 → P1-1 RLS context와 자동 통합.

import NextAuth from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Resend from 'next-auth/providers/resend'
import NeonAdapter from '@auth/neon-adapter'
import { getAuthPool } from '@/lib/auth/pool'
import { isFixture } from '@/lib/db/client'

// Resend API key가 없을 때는 console magic link (dev fallback).
function makeProviders() {
  const apiKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY
  const from = process.env.AUTH_EMAIL_FROM ?? 'noreply@example.invalid'
  if (apiKey) return [Resend({ apiKey, from })]
  if (process.env.NODE_ENV === 'production') return []
  return [
    Resend({
      apiKey: 'dev-stub',
      from,
      sendVerificationRequest: async () => {
        console.error('[auth:dev-magic-link] verification requested; configure Resend for delivery')
      }
    })
  ]
}

export const authConfig: NextAuthConfig = {
  // fixture 모드(DATABASE_URL 없음)에서는 adapter 없이 빌드/구동 가능해야 한다.
  // 이때 admin 로그인은 비활성 — magic link 검증 토큰 저장소가 없기 때문.
  ...(isFixture() ? {} : { adapter: NeonAdapter(getAuthPool()) }),
  providers: makeProviders(),
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }, // 8h
  trustHost: true,
  pages: {
    signIn: '/admin/login',
    verifyRequest: '/admin/verify',
    error: '/admin/error'
  },
  callbacks: {
    async jwt({ token, user, trigger }) {
      // 신규 로그인 시 user (DB row) 정보를 token에 복사
      if (user) {
        token.sub = user.id
        const u = user as { role?: string; email?: string | null }
        token.role = u.role ?? 'instructor'
        token.email = u.email ?? token.email
      }
      // 토큰 갱신 시 DB role을 다시 fetch (역할 승격 반영)
      if (trigger === 'update' && token.sub) {
        try {
          const pool = getAuthPool()
          const r = await pool.query('select role from next_auth.users where id = $1', [token.sub])
          if (r.rows[0]?.role) token.role = r.rows[0].role
        } catch {
          // ignore
        }
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        const u = session.user as { id?: string; role?: string }
        u.id = token.sub as string
        u.role = (token.role as string) ?? 'instructor'
      }
      return session
    },
    authorized({ auth }) {
      return !!auth?.user
    }
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig)
