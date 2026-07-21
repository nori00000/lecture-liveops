import { z } from 'zod'
import { participants, delibGroups, delibRounds, statements, votes, landscape } from '@/lib/db/repo'
import { RoundModeEnum, StatementVisibilityEnum, VoteValueEnum, ModerationActionEnum } from '@/lib/db/schema'
import { envelopeToCtx } from '../context'
import { computeSnapshotPayload } from '@/lib/delib/metrics'
import type { Handler } from './types'

// ============================================================
// delib.* — 숙의 워크숍 액션 10종 (PRODUCT-PLAN-v2 §3)
// ============================================================

const CreateWorkshopInput = z.object({
  sessionId: z.string(),
  title: z.string().default(''),
  topic: z.string().optional()
})

// 워크숍 부트스트랩 — 세션의 오프닝 plenary 라운드(round_index 0)를 active 로 생성.
export const createWorkshop: Handler = async ({ envelope }) => {
  const input = CreateWorkshopInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const round = await delibRounds.create(ctx, {
    session_id: input.sessionId,
    round_index: 0,
    title: input.title,
    mode: 'plenary',
    status: 'active'
  })
  return { data: { roundId: round.id, sessionId: input.sessionId }, summary: `workshop created (round ${round.id})` }
}

const RegisterParticipantInput = z.object({
  sessionId: z.string(),
  displayAlias: z.string().optional(),
  anonHandle: z.string().optional(),
  accessKeyId: z.string().optional()
})

export const registerParticipant: Handler = async ({ envelope }) => {
  const input = RegisterParticipantInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await participants.register(ctx, {
    session_id: input.sessionId,
    display_alias: input.displayAlias ?? '',
    anon_handle: input.anonHandle ?? '',
    access_key_id: input.accessKeyId ?? null
  })
  return { data: { participantId: row.id }, summary: `participant registered ${row.id}` }
}

const UpsertGroupInput = z.object({
  sessionId: z.string(),
  groupId: z.string().optional(),
  label: z.string(),
  topic: z.string().optional()
})

export const upsertGroup: Handler = async ({ envelope }) => {
  const input = UpsertGroupInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await delibGroups.upsert(ctx, {
    id: input.groupId,
    session_id: input.sessionId,
    label: input.label,
    topic: input.topic
  })
  return { data: { groupId: row.id, label: row.label }, summary: `group upserted ${row.id}` }
}

const AssignParticipantInput = z.object({
  participantId: z.string(),
  groupId: z.string()
})

export const assignParticipant: Handler = async ({ envelope }) => {
  const input = AssignParticipantInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await delibGroups.assignParticipant(ctx, input.participantId, input.groupId)
  return { data: { participantId: row.participant_id, groupId: row.group_id }, summary: `participant ${row.participant_id} → group ${row.group_id}` }
}

const StartRoundInput = z.object({
  sessionId: z.string(),
  roundIndex: z.number().int(),
  title: z.string().default(''),
  mode: RoundModeEnum.default('plenary')
})

// 라운드 생성 후 시작(active). 같은 세션의 기존 active 라운드는 closed 로 전환.
export const startRound: Handler = async ({ envelope }) => {
  const input = StartRoundInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const round = await delibRounds.create(ctx, {
    session_id: input.sessionId,
    round_index: input.roundIndex,
    title: input.title,
    mode: input.mode,
    status: 'pending'
  })
  const active = await delibRounds.activate(ctx, round.id)
  return { data: { roundId: round.id, status: active?.status ?? 'active' }, summary: `round ${input.roundIndex} started (${round.id})` }
}

const SubmitStatementInput = z.object({
  sessionId: z.string(),
  roundId: z.string().optional(),
  groupId: z.string().optional(),
  authorParticipantId: z.string().optional(),
  body: z.string().min(1),
  visibility: StatementVisibilityEnum.optional()
})

export const submitStatement: Handler = async ({ envelope }) => {
  const input = SubmitStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await statements.submit(ctx, {
    session_id: input.sessionId,
    round_id: input.roundId ?? null,
    group_id: input.groupId ?? null,
    author_participant_id: input.authorParticipantId ?? null,
    body: input.body,
    visibility: input.visibility ?? 'group'
  })
  return { data: { statementId: row.id }, summary: `statement submitted ${row.id}` }
}

const ModerateStatementInput = z.object({
  statementId: z.string(),
  action: ModerationActionEnum,
  reason: z.string().optional()
})

export const moderateStatement: Handler = async ({ envelope }) => {
  const input = ModerateStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await statements.moderate(ctx, input.statementId, input.action, envelope.actor.role, input.reason ?? '')
  if (!row) throw new Error('statement not found')
  return { data: { statementId: row.id, moderationState: row.moderation_state }, summary: `statement ${row.id} ${input.action} → ${row.moderation_state}` }
}

const VoteStatementInput = z.object({
  statementId: z.string(),
  participantId: z.string(),
  vote: VoteValueEnum
})

// 중복 투표는 upsert 로 변경 허용. unique(statement_id, participant_id) 가 최종 방어선.
export const voteStatement: Handler = async ({ envelope }) => {
  const input = VoteStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await votes.cast(ctx, {
    statement_id: input.statementId,
    participant_id: input.participantId,
    vote: input.vote
  })
  return { data: { statementId: row.statement_id, vote: row.vote }, summary: `vote ${row.vote} on ${row.statement_id}` }
}

const ComputeSnapshotInput = z.object({
  sessionId: z.string(),
  roundId: z.string().optional()
})

// 집계 지형 스냅샷 계산 + 저장 (개인 표 원자료 없이 집계만).
export const computeSnapshot: Handler = async ({ envelope }) => {
  const input = ComputeSnapshotInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const rows = await statements.list(ctx, input.sessionId, input.roundId)
  const ids = rows.map((s) => s.id)
  const tallies = await votes.tallyByStatements(ctx, ids)
  const payload = computeSnapshotPayload(
    rows.map((s) => ({ id: s.id, group_id: s.group_id })),
    tallies
  )
  const snapshot = await landscape.compute(ctx, {
    session_id: input.sessionId,
    round_id: input.roundId ?? null,
    payload: payload as unknown as Record<string, unknown>
  })
  return { data: { snapshotId: snapshot.id, statementCount: ids.length }, summary: `snapshot computed ${snapshot.id}` }
}

const PublishSnapshotInput = z.object({
  snapshotId: z.string()
})

export const publishSnapshot: Handler = async ({ envelope }) => {
  const input = PublishSnapshotInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await landscape.publish(ctx, input.snapshotId)
  if (!row) throw new Error('snapshot not found')
  return { data: { snapshotId: row.id, publishedAt: row.published_at }, summary: `snapshot published ${row.id}` }
}
