import { z } from 'zod'
import { opsLogs } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const Input = z.object({
  sessionId: z.string(),
  logType: z.enum(['issue', 'mood', 'signal', 'question', 'progress', 'resource', 'note']),
  body: z.string().min(1),
  visibility: z.enum(['public', 'session', 'private', 'admin_only']).default('private')
})

export const appendOpsLog: Handler = async ({ envelope }) => {
  const input = Input.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await opsLogs.insert(ctx, {
    session_id: input.sessionId,
    type: input.logType,
    body: input.body,
    visibility: input.visibility,
    created_by_role: envelope.actor.role
  })
  return { data: { id: row.id }, summary: `ops_log ${row.type}` }
}

const DeleteInput = z.object({ sessionId: z.string().min(1), opsLogId: z.string().min(1) })

// 운영 로그(=상황판 타임라인의 ops_log·좌석일지 항목) 1건 삭제.
export const deleteOpsLog: Handler = async ({ envelope }) => {
  const input = DeleteInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  await opsLogs.delete(ctx, input.opsLogId)
  return { data: { deleted: input.opsLogId }, summary: `ops_log deleted: ${input.opsLogId}` }
}
