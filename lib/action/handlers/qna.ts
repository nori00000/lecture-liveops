import { z } from 'zod'
import { qna } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import { onQnaAnswered } from '@/lib/notify/hooks'
import type { Handler } from './types'

const AddQnaInput = z.object({
  sessionId: z.string(),
  body: z.string().min(1),
  authorLabel: z.string().optional(),
  tags: z.array(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional()
})

export const addQna: Handler = async ({ envelope }) => {
  const input = AddQnaInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await qna.insert(ctx, {
    session_id: input.sessionId,
    body: input.body,
    body_redacted: input.body.slice(0, 80),
    answer: null,
    status: 'new',
    priority: input.priority ?? 'normal',
    tags: input.tags ?? [],
    visibility: 'session',
    created_by_role: envelope.actor.role
  })
  return { data: { id: row.id, status: row.status }, summary: `qna inserted ${row.id}` }
}

const AnswerQnaInput = z.object({
  qnaId: z.string(),
  answer: z.string().min(1),
  status: z.enum(['answered', 'needs_follow_up', 'sent_to_company']).default('answered')
})

export const answerQna: Handler = async ({ envelope }) => {
  const input = AnswerQnaInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await qna.answer(ctx, input.qnaId, input.answer, input.status)
  if (!row) throw new Error('qna not found')
  // fire-and-forget — author email은 v1 schema에 없으므로 hook은 no-op이지만 ledger에는 기록
  void onQnaAnswered({ sessionId: row.session_id, preview: input.answer })
  return { data: { id: row.id, status: row.status }, summary: `qna answered ${row.id}` }
}

const DeleteQnaInput = z.object({
  qnaId: z.string()
})

export const deleteQna: Handler = async ({ envelope }) => {
  const input = DeleteQnaInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const existing = await qna.findById(ctx, input.qnaId)
  if (!existing) throw new Error('qna not found')
  await qna.delete(ctx, input.qnaId)
  return { data: { id: input.qnaId, deleted: true }, summary: `qna deleted ${input.qnaId}` }
}

const UpdateStatusInput = z.object({
  qnaId: z.string(),
  status: z.enum(['new', 'triaged', 'answered', 'needs_follow_up', 'sent_to_company', 'archived'])
})

export const updateQnaStatus: Handler = async ({ envelope }) => {
  const input = UpdateStatusInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await qna.updateStatus(ctx, input.qnaId, input.status)
  if (!row) throw new Error('qna not found')
  return { data: { id: row.id, status: row.status }, summary: `qna status ${row.status}` }
}
