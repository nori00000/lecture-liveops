'use client'

import type { Role } from '@/lib/db/schema'
import { apiFetch } from '@/lib/api/fetcher'

export type ActionInvocation = {
  action: string
  role?: Role
  scope?: { sessionId?: string; companyId?: string; courseId?: string }
  input?: unknown
  dryRun?: boolean
}

export async function invoke({ action, role = 'admin', scope = {}, input = {}, dryRun = false }: ActionInvocation) {
  const envelope = {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope,
    idempotencyKey: crypto.randomUUID(),
    redactionPolicy: 'summary',
    dryRun,
    input
  }
  const res = await apiFetch('/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope)
  })
  return res.json()
}
