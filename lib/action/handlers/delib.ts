import { z } from 'zod'
import { sessions, participants, delibGroups, delibRounds, statements, votes, landscape } from '@/lib/db/repo'
import { RoundModeEnum, StatementVisibilityEnum, VoteValueEnum, ModerationActionEnum } from '@/lib/db/schema'
import { envelopeToCtx } from '../context'
import { computeSnapshotPayload } from '@/lib/delib/metrics'
import { computeLandscape, landscapeUnavailable } from '@/lib/delib/landscapeMetrics'
import { nowIso } from '@/lib/util/id'
import type { Handler } from './types'

// ============================================================
// delib.* — 숙의 워크숍 액션 10종 (PRODUCT-PLAN-v2 §3)
// ============================================================

// ------------------------------------------------------------
// M1: 프라이버시 게이트 서버 영속 + 사전 합의 서버 검증.
// 설정은 sessions.metadata.privacy_settings(jsonb, 기존 필드)에 저장한다 — 마이그레이션 불필요.
// 클라이언트 게이트(설정 페이지)는 UX 보조일 뿐, 합의 미확정 시 서버가 create/start 를 거부한다.
// ------------------------------------------------------------

const DisclosureEnum = z.enum(['participants', 'operators_only', 'public'])

export type PrivacySettings = {
  anonymousMode: boolean
  disclosure: z.infer<typeof DisclosureEnum>
  retentionDays: number
  minorSession: boolean
  consentConfirmed: boolean
  minorConsent: boolean
  updatedAt: string
}

const UpdateWorkshopSettingsInput = z.object({
  sessionId: z.string(),
  anonymousMode: z.boolean(),
  disclosure: DisclosureEnum,
  retentionDays: z.number().int().positive(),
  minorSession: z.boolean(),
  consentConfirmed: z.boolean(),
  minorConsent: z.boolean().optional()
})

// 세션 metadata 에서 privacy_settings 를 안전하게 추출 (없거나 형태 불일치면 undefined).
function readPrivacySettings(metadata: Record<string, unknown> | undefined): Partial<PrivacySettings> | undefined {
  const ps = metadata?.privacy_settings
  if (!ps || typeof ps !== 'object') return undefined
  return ps as Partial<PrivacySettings>
}

// 사전 합의 서버 게이트 — consentConfirmed 미확정이면 워크숍 시작/생성 거부.
// 미성년자 세션이면 법정대리인 동의(minorConsent)까지 확인 (§7-4).
async function assertConsentConfirmed(ctx: ReturnType<typeof envelopeToCtx>, sessionId: string): Promise<void> {
  const session = await sessions.findById(ctx, sessionId)
  if (!session) throw new Error('delib: session not found')
  const ps = readPrivacySettings(session.metadata)
  if (!ps || ps.consentConfirmed !== true) {
    throw new Error('delib: privacy consent not confirmed')
  }
  if (ps.minorSession === true && ps.minorConsent !== true) {
    throw new Error('delib: minor guardian consent required')
  }
}

// 운영자 전용 — 프라이버시/공개범위/보관기간/사전합의를 세션 metadata 에 영속화한다.
export const updateWorkshopSettings: Handler = async ({ envelope }) => {
  const input = UpdateWorkshopSettingsInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const session = await sessions.findById(ctx, input.sessionId)
  if (!session) throw new Error('delib: session not found')
  const privacy_settings: PrivacySettings = {
    anonymousMode: input.anonymousMode,
    disclosure: input.disclosure,
    retentionDays: input.retentionDays,
    minorSession: input.minorSession,
    consentConfirmed: input.consentConfirmed,
    minorConsent: input.minorConsent ?? false,
    updatedAt: nowIso()
  }
  // 기존 metadata 다른 필드(capacity/tables 등)를 보존하며 privacy_settings 만 병합.
  const nextMetadata = { ...(session.metadata ?? {}), privacy_settings }
  await sessions.updateMetadata(ctx, input.sessionId, nextMetadata)
  return { data: { sessionId: input.sessionId, privacySettings: privacy_settings }, summary: `workshop settings updated ${input.sessionId}` }
}

const CreateWorkshopInput = z.object({
  sessionId: z.string(),
  title: z.string().default(''),
  topic: z.string().optional()
})

// 워크숍 부트스트랩 — 세션의 오프닝 plenary 라운드(round_index 0)를 active 로 생성.
// startRound 원자 경로 경유 — 기존 active 를 닫고 새 라운드를 active 로 (N-2, active 단일성 M-4).
// M1: 사전 합의가 서버에 확정되지 않았으면 시작 불가.
export const createWorkshop: Handler = async ({ envelope }) => {
  const input = CreateWorkshopInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  await assertConsentConfirmed(ctx, input.sessionId)
  const round = await delibRounds.startRound(ctx, {
    session_id: input.sessionId,
    round_index: 0,
    title: input.title,
    mode: 'plenary'
  })
  return { data: { roundId: round.id, sessionId: input.sessionId }, summary: `workshop created (round ${round.id})` }
}

const RegisterParticipantInput = z.object({
  sessionId: z.string(),
  displayAlias: z.string().optional(),
  anonHandle: z.string().optional()
})

// 운영자 전용 (permissions 에서 participant 제거). access_key 바인딩은 /p/enter 서버 경로에서만 —
// 여기서는 access_key_id 를 절대 클라이언트 입력으로 받지 않는다 (사칭 방지, N-4).
export const registerParticipant: Handler = async ({ envelope }) => {
  const input = RegisterParticipantInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await participants.register(ctx, {
    session_id: input.sessionId,
    display_alias: input.displayAlias ?? '',
    anon_handle: input.anonHandle ?? '',
    access_key_id: null
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

// 라운드 시작 — 원자 연산 (M-4). 기존 active 를 closed 로 내리고 새 라운드를 active 로 삽입.
// M1: 사전 합의가 서버에 확정되지 않았으면 라운드 시작 불가.
export const startRound: Handler = async ({ envelope }) => {
  const input = StartRoundInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  await assertConsentConfirmed(ctx, input.sessionId)
  const round = await delibRounds.startRound(ctx, {
    session_id: input.sessionId,
    round_index: input.roundIndex,
    title: input.title,
    mode: input.mode
  })
  return { data: { roundId: round.id, status: round.status }, summary: `round ${input.roundIndex} started (${round.id})` }
}

const SubmitStatementInput = z.object({
  sessionId: z.string(),
  roundId: z.string().optional(),
  groupId: z.string().optional(),
  authorParticipantId: z.string().optional(),
  body: z.string().min(1),
  visibility: StatementVisibilityEnum.optional()
})

// C-E: round/group/author 가 대상 세션에 속하는지 + 대상 라운드가 closed 가 아닌지 검증.
// 핸들러 1차 방어(fixture/Neon 공통), Neon delib_statement_guard trigger 가 2차 방어.
async function assertStatementScope(
  ctx: ReturnType<typeof envelopeToCtx>,
  sessionId: string,
  roundId: string | null,
  groupId: string | null,
  authorParticipantId: string | null
): Promise<void> {
  if (roundId) {
    const round = await delibRounds.findById(ctx, roundId)
    if (!round || round.session_id !== sessionId) throw new Error('delib: statement round session mismatch')
    if (round.status === 'closed') throw new Error('delib: cannot submit to a closed round')
  }
  if (groupId) {
    const group = await delibGroups.findById(ctx, groupId)
    if (!group || group.session_id !== sessionId) throw new Error('delib: statement group session mismatch')
  }
  if (authorParticipantId) {
    const author = await participants.findById(ctx, authorParticipantId)
    if (!author || author.session_id !== sessionId) throw new Error('delib: statement author session mismatch')
  }
}

export const submitStatement: Handler = async ({ envelope, trusted }) => {
  const input = SubmitStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope, trusted)
  // participant 는 세션 스코프를 쿠키에서만 신뢰. operator 는 input.sessionId 사용.
  const sessionId = envelope.actor.role === 'participant' ? (envelope.scope.sessionId ?? input.sessionId) : input.sessionId
  // 저자 신원: participant 는 서버 신뢰 쿠키의 participantId 만 사용 (input.authorParticipantId 무시, C-A/C-E).
  //           operator 는 대리 입력 허용.
  const authorParticipantId = envelope.actor.role === 'participant'
    ? (trusted?.participantId ?? null)
    : (input.authorParticipantId ?? null)
  if (envelope.actor.role === 'participant' && !authorParticipantId) {
    throw new Error('delib: participant identity required')
  }
  await assertStatementScope(ctx, sessionId, input.roundId ?? null, input.groupId ?? null, authorParticipantId)
  const row = await statements.submit(ctx, {
    session_id: sessionId,
    round_id: input.roundId ?? null,
    group_id: input.groupId ?? null,
    author_participant_id: authorParticipantId,
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

// actorRole 은 서버 authz 게이트를 통과한 envelope.actor.role — 감사에 클라이언트 별도 주장 role 을
// 기록하지 않는다 (N-5). 상태전이 검증은 repo(statements.moderate)의 전이표가 담당 (M-5).
export const moderateStatement: Handler = async ({ envelope }) => {
  const input = ModerateStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await statements.moderate(ctx, input.statementId, input.action, envelope.actor.role, input.reason ?? '')
  if (!row) throw new Error('statement not found')
  return { data: { statementId: row.id, moderationState: row.moderation_state }, summary: `statement ${row.id} ${input.action} → ${row.moderation_state}` }
}

const VoteStatementInput = z.object({
  statementId: z.string(),
  // participant 는 서버가 쿠키에서 신원을 주입하므로 무시된다. operator 대리 투표에만 사용.
  participantId: z.string().optional(),
  vote: VoteValueEnum
})

// 중복 투표는 upsert 로 변경 허용. unique(statement_id, participant_id) 가 최종 방어선.
// C-A: participant 신원은 input 을 신뢰하지 않고 서버 신뢰 쿠키(trusted.participantId)만 사용 → 표 위조 차단.
export const voteStatement: Handler = async ({ envelope, trusted }) => {
  const input = VoteStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope, trusted)
  const participantId = envelope.actor.role === 'participant'
    ? (trusted?.participantId ?? '')
    : (input.participantId ?? '')
  if (!participantId) throw new Error('delib: participant identity required')
  // 크로스세션 투표 차단 (C-A/C-B): 발언과 투표자가 현재 세션에 속해야 한다. Neon trigger 가 2차 방어.
  const statement = await statements.findById(ctx, input.statementId)
  if (!statement) throw new Error('statement not found')
  if (envelope.scope.sessionId && statement.session_id !== envelope.scope.sessionId) {
    throw new Error('delib: vote session mismatch')
  }
  const voter = await participants.findById(ctx, participantId)
  if (!voter || voter.session_id !== statement.session_id) throw new Error('delib: vote session mismatch')
  const row = await votes.cast(ctx, {
    statement_id: input.statementId,
    participant_id: participantId,
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
  // 집계는 visible 발언만 포함 (hidden/flagged 는 지형에서 제외, M-1).
  const rows = await statements.list(ctx, input.sessionId, input.roundId, { visibleOnly: true })
  const ids = rows.map((s) => s.id)
  const tallies = await votes.tallyByStatements(ctx, ids)
  const payload = computeSnapshotPayload(
    rows.map((s) => ({ id: s.id, group_id: s.group_id })),
    tallies
  )
  // Post-MVP B: 의견 지형(클러스터링) 레이어. 기존 랭킹은 그대로 두고 landscape 필드만 덧붙인다.
  // 마이그레이션 불필요 — landscape_snapshots.payload 는 jsonb.
  // 개인 표 행렬은 여기(서버 메모리)에서만 쓰이고 payload 에는 익명 좌표/집계만 담긴다 (거버넌스 §7-2).
  const parts = await participants.list(ctx, input.sessionId)
  const voteRows = await votes.matrixForClustering(ctx, ids)
  const landscapeResult = voteRows == null
    ? landscapeUnavailable(parts.length)
    : computeLandscape({
        votes: voteRows.map((v) => ({ participantId: v.participant_id, statementId: v.statement_id, vote: v.vote })),
        statementIds: ids,
        participantIds: parts.map((p) => p.id)
      })
  const snapshot = await landscape.compute(ctx, {
    session_id: input.sessionId,
    round_id: input.roundId ?? null,
    payload: { ...payload, landscape: landscapeResult } as unknown as Record<string, unknown>
  })
  return {
    data: { snapshotId: snapshot.id, statementCount: ids.length, landscapeEnabled: landscapeResult.enabled },
    summary: `snapshot computed ${snapshot.id}`
  }
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
