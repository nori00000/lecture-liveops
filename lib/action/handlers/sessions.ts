import { z } from 'zod'
import { sessions } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const Input = z.object({
  date: z.string().optional(),
  companyId: z.string().optional()
})

export const getTodaySession: Handler = async ({ envelope }) => {
  const input = Input.parse(envelope.input ?? {})
  const ctx = envelopeToCtx(envelope)
  let row = await sessions.getToday(ctx)
  if (input.date) {
    const matches = await sessions.findByDate(ctx, input.date)
    if (matches[0]) row = matches[0]
  }
  if (input.companyId) {
    const matches = await sessions.findByCompany(ctx, input.companyId)
    if (matches[0]) row = matches[0]
  }
  if (!row) throw new Error('no session')
  return { data: { id: row.id, title: row.title, mode: row.mode, date: row.date }, summary: `session ${row.id} ${row.mode}` }
}
