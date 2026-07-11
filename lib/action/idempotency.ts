import type { AxActionResult } from './envelope'

type Entry = { result: AxActionResult; expiresAt: number }

declare global {
  var __AX_IDEMPOTENCY__: Map<string, Entry> | undefined
}

const TTL_MS = 5 * 60 * 1000

function store(): Map<string, Entry> {
  if (!globalThis.__AX_IDEMPOTENCY__) globalThis.__AX_IDEMPOTENCY__ = new Map()
  return globalThis.__AX_IDEMPOTENCY__!
}

function key(action: string, idempotencyKey: string): string {
  return `${action}::${idempotencyKey}`
}

export function getCached(action: string, idempotencyKey: string): AxActionResult | null {
  const s = store()
  const k = key(action, idempotencyKey)
  const e = s.get(k)
  if (!e) return null
  if (Date.now() > e.expiresAt) {
    s.delete(k)
    return null
  }
  return { ...e.result, cached: true, status: 'cached' }
}

export function setCached(action: string, idempotencyKey: string, result: AxActionResult): void {
  const s = store()
  s.set(key(action, idempotencyKey), { result, expiresAt: Date.now() + TTL_MS })
  // simple size cap
  if (s.size > 1000) {
    const oldest = s.keys().next().value
    if (oldest) s.delete(oldest)
  }
}
