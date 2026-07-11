import { z } from 'zod'
import { practice } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const CreateInput = z.object({
  sessionId: z.string(),
  tableLabel: z.string().optional(),
  body: z.string().min(1),
  severity: z.enum(['low', 'normal', 'high', 'blocker']).optional()
})

export const createPracticeTicket: Handler = async ({ envelope }) => {
  const input = CreateInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await practice.insert(ctx, {
    session_id: input.sessionId,
    table_label: input.tableLabel ?? '',
    body: input.body,
    status: 'help_needed',
    severity: input.severity ?? 'normal',
    assigned_assistant_id: null
  })
  return { data: { id: row.id }, summary: `practice ticket ${row.id}` }
}

const UpdateInput = z.object({
  ticketId: z.string(),
  status: z.enum(['help_needed', 'assisting', 'solved', 'follow_up']),
  note: z.string().optional()
})

export const updatePracticeTicket: Handler = async ({ envelope }) => {
  const input = UpdateInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await practice.update(ctx, input.ticketId, { status: input.status })
  if (!row) throw new Error('practice ticket not found')
  return { data: { id: row.id, status: row.status }, summary: `practice ${row.status}` }
}
