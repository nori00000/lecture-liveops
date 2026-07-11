'use client'

import { openDB, type IDBPDatabase } from 'idb'
import { apiFetch } from '@/lib/api/fetcher'

type QueuedItem = {
  id: string
  envelope: unknown
  createdAt: number
  attempts: number
}

const DB_NAME = 'ax-offline-queue'
const STORE = 'pending'

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
  })
}

export async function enqueue(envelope: unknown): Promise<string> {
  const d = await db()
  const id = crypto.randomUUID()
  await d.put(STORE, { id, envelope, createdAt: Date.now(), attempts: 0 } satisfies QueuedItem)
  return id
}

export async function flush(): Promise<{ flushed: number; failed: number }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { flushed: 0, failed: 0 }
  const d = await db()
  const all = (await d.getAll(STORE)) as QueuedItem[]
  let flushed = 0
  let failed = 0
  for (const item of all) {
    try {
      const res = await apiFetch('/api/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(item.envelope)
      })
      if (res.ok) {
        await d.delete(STORE, item.id)
        flushed += 1
      } else {
        item.attempts += 1
        await d.put(STORE, item)
        failed += 1
      }
    } catch {
      failed += 1
    }
  }
  return { flushed, failed }
}

export async function size(): Promise<number> {
  const d = await db()
  return d.count(STORE)
}
