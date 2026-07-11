// Lecture LiveOps — Neon Pool for NextAuth adapter (P2-1)
// @auth/neon-adapter는 Pool (websocket) 기반. owner role 사용 (auth 테이블 read/write 권한).
// 서버 internal — anon role과 분리.

import { Pool } from '@neondatabase/serverless'

let cachedPool: Pool | null = null

export function getAuthPool(): Pool {
  if (cachedPool) return cachedPool
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set — NextAuth adapter requires owner pool')
  cachedPool = new Pool({ connectionString: url })
  return cachedPool
}
