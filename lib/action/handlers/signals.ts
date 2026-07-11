import { z } from 'zod'
import { signals, tableStatuses } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import { onSignalRaised } from '@/lib/notify/hooks'
import type { Handler } from './types'

const SignalInput = z.object({
  sessionId: z.string(),
  signalType: z.enum(['speed_down', 'break_needed', 'question_surge', 'practice_blocked', 'lunch_delay', 'network', 'mood_drop']),
  tableLabel: z.string().optional(),
  note: z.string().optional()
})

export const sendAssistantSignal: Handler = async ({ envelope }) => {
  const input = SignalInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await signals.insert(ctx, {
    session_id: input.sessionId,
    signal_type: input.signalType,
    table_label: input.tableLabel ?? '',
    note: input.note ?? '',
    acknowledged_at: null
  })
  // fire-and-forget 알림 (실패 무시)
  void onSignalRaised({ sessionId: input.sessionId, signalType: input.signalType, tableLabel: input.tableLabel })
  return { data: { id: row.id }, summary: `signal ${row.signal_type}` }
}

const AckInput = z.object({ signalId: z.string() })

// 강사가 신호를 확인 — 퍼실리테이터 쪽 "확인됨" 표시용 (acknowledged_at 기록)
export const acknowledgeSignal: Handler = async ({ envelope }) => {
  const input = AckInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await signals.acknowledge(ctx, input.signalId)
  if (!row) {
    throw new Error('signal not found')
  }
  return { data: { id: row.id, acknowledgedAt: row.acknowledged_at }, summary: `signal ${row.id} acknowledged` }
}

const TableInput = z.object({
  sessionId: z.string(),
  tableLabel: z.string(),
  progress: z.enum(['not_started', 'following', 'blocked', 'solved', 'waiting']),
  blocker: z.string().optional(),
  assistantId: z.string().optional()
})

export const updateTableStatus: Handler = async ({ envelope }) => {
  const input = TableInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await tableStatuses.upsert(ctx, {
    session_id: input.sessionId,
    table_label: input.tableLabel,
    progress: input.progress,
    blocker: input.blocker,
    assistant_id: input.assistantId ?? null
  })
  return { data: { id: row.id, progress: row.progress }, summary: `table ${row.table_label} ${row.progress}` }
}
