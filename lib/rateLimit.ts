// Lecture LiveOps — in-memory sliding window rate limiter (P1-2)
// 단일 Vercel function instance 한정. multi-region scale 필요 시 Upstash로 교체.
// /api/health / /api/csp/report 는 호출 측에서 제외.

type Bucket = { count: number; resetAt: number }

declare global {
  var __AX_RATELIMIT__: Map<string, Bucket> | undefined
}

const WINDOW_MS = 60_000
const ANON_LIMIT = 30
const AUTH_LIMIT = 60

function store(): Map<string, Bucket> {
  if (!globalThis.__AX_RATELIMIT__) globalThis.__AX_RATELIMIT__ = new Map()
  return globalThis.__AX_RATELIMIT__!
}

export type RateLimitResult = {
  limited: boolean
  count: number
  limit: number
  resetAt: number
  retryAfterSec: number
}

export function checkRateLimit(ip: string, pathname: string): RateLimitResult {
  const limit = pathname.startsWith('/api/admin') ? AUTH_LIMIT : ANON_LIMIT
  const key = `${ip}:${pathname}`
  const now = Date.now()
  const s = store()
  const b = s.get(key)
  if (!b || b.resetAt < now) {
    s.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { limited: false, count: 1, limit, resetAt: now + WINDOW_MS, retryAfterSec: 60 }
  }
  b.count += 1
  // size cap (memory guard)
  if (s.size > 5000) {
    const oldest = s.keys().next().value
    if (oldest) s.delete(oldest)
  }
  return {
    limited: b.count > limit,
    count: b.count,
    limit,
    resetAt: b.resetAt,
    retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000))
  }
}

export function resetRateLimitForTest(): void {
  globalThis.__AX_RATELIMIT__ = new Map()
}
