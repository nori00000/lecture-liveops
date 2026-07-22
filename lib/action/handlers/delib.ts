import { z } from 'zod'
import { sessions, participants, delibGroups, delibRounds, statements, votes, landscape, aiObservations } from '@/lib/db/repo'
import { RoundModeEnum, StatementVisibilityEnum, VoteValueEnum, ModerationActionEnum, EvidenceKindEnum } from '@/lib/db/schema'
import { envelopeToCtx } from '../context'
import { computeSnapshotPayload } from '@/lib/delib/metrics'
import { analyzeStatements, assertProviderAllowed, resolveProvider } from '@/lib/delib/aiProvider'
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
  // 녹음·전사 동의 (transcript-architecture §4). 전사 수집 경로는 이 플래그 없이는 열리지 않는다.
  recordingConsent: boolean
  recordingConsentAt: string | null
  // 오프사이트(현장 박스 밖) 처리 허용 — 기본 false, 코드가 거부한다 (architecture §1).
  offsiteProcessing: boolean
  updatedAt: string
}

const UpdateWorkshopSettingsInput = z.object({
  sessionId: z.string(),
  anonymousMode: z.boolean(),
  disclosure: DisclosureEnum,
  retentionDays: z.number().int().positive(),
  minorSession: z.boolean(),
  consentConfirmed: z.boolean(),
  minorConsent: z.boolean().optional(),
  recordingConsent: z.boolean().optional(),
  offsiteProcessing: z.boolean().optional()
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

// 녹음·전사 동의 상태를 privacy_settings 에서 안전하게 읽는다 (배너·게이트 공용).
// 미설정 세션은 전부 false — fail-closed.
export function readRecordingConsent(metadata: Record<string, unknown> | undefined): {
  active: boolean
  consentAt: string | null
  offsiteProcessing: boolean
} {
  const ps = readPrivacySettings(metadata)
  const active = ps?.recordingConsent === true
  return {
    active,
    consentAt: active && typeof ps?.recordingConsentAt === 'string' ? ps.recordingConsentAt : null,
    offsiteProcessing: ps?.offsiteProcessing === true
  }
}

// 전사 수집 서버 게이트 — 전사 ingest 계열 액션·라우트가 재사용한다 (transcript-architecture §4).
// recordingConsent 없이는 전사 데이터가 한 건도 들어올 수 없다. 사전합의(consentConfirmed)가 선행 조건.
export async function enforceRecordingConsent(
  ctx: ReturnType<typeof envelopeToCtx>,
  sessionId: string
): Promise<void> {
  const session = await sessions.findById(ctx, sessionId)
  if (!session) throw new Error('delib: session not found')
  const ps = readPrivacySettings(session.metadata)
  if (!ps || ps.consentConfirmed !== true) {
    throw new Error('delib: privacy consent not confirmed')
  }
  if (ps.recordingConsent !== true) {
    throw new Error('delib: recording consent not confirmed')
  }
}

// 녹음 동의 설정의 정합성 검증 — 저장 시점에 모순 상태를 거부한다.
//  - 사전합의(consentConfirmed) 없이 녹음 동의만 켜는 것 금지
//  - 오프사이트 처리는 녹음 동의 + 별도 계약 전제 (architecture §1) → 녹음 동의 없이는 거부
function assertRecordingConsistency(consentConfirmed: boolean, recordingConsent: boolean, offsiteProcessing: boolean): void {
  if (recordingConsent && !consentConfirmed) {
    throw new Error('delib: recording consent requires privacy consent')
  }
  if (offsiteProcessing && !recordingConsent) {
    throw new Error('delib: offsite processing requires recording consent')
  }
}

// 운영자 전용 — 프라이버시/공개범위/보관기간/사전합의/녹음동의를 세션 metadata 에 영속화한다.
export const updateWorkshopSettings: Handler = async ({ envelope }) => {
  const input = UpdateWorkshopSettingsInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const session = await sessions.findById(ctx, input.sessionId)
  if (!session) throw new Error('delib: session not found')
  const recordingConsent = input.recordingConsent === true
  const offsiteProcessing = input.offsiteProcessing === true
  assertRecordingConsistency(input.consentConfirmed, recordingConsent, offsiteProcessing)
  // 동의 시각은 최초 동의 시점을 보존한다(재저장으로 갱신되지 않음). 동의 해제 시 null.
  const prev = readPrivacySettings(session.metadata)
  const recordingConsentAt = recordingConsent
    ? (prev?.recordingConsent === true && typeof prev.recordingConsentAt === 'string' ? prev.recordingConsentAt : nowIso())
    : null
  const privacy_settings: PrivacySettings = {
    anonymousMode: input.anonymousMode,
    disclosure: input.disclosure,
    retentionDays: input.retentionDays,
    minorSession: input.minorSession,
    consentConfirmed: input.consentConfirmed,
    minorConsent: input.minorConsent ?? false,
    recordingConsent,
    recordingConsentAt,
    offsiteProcessing,
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
  visibility: StatementVisibilityEnum.optional(),
  // Q1: 근거 유형 자기 태깅 (DELIBERATION-QUALITY-PLAN §2 Q1). **선택사항** — 미지정이면 null 로 저장.
  // 판정이 아니라 자기 귀속이므로 서버는 값 검증(enum)만 하고 내용을 해석하지 않는다.
  // Codex2: 대리입력(operator 가 authorParticipantId 지정) 경로에서는 값이 와도 **저장하지 않는다** — 아래 참조.
  evidenceKind: EvidenceKindEnum.optional()
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
  // Codex2 (대리입력 오귀속 차단): Q1 근거 유형은 **참가자 본인이 고른 값**으로만 집계된다.
  // operator 가 참가자를 지정해 대신 입력하는 경로에서 온 태그는 실제 선택 주체가 운영자이므로,
  // 그대로 저장하면 "참가자 자기 선택 분포"(§5 지표)가 조용히 오염된다.
  // 출처 컬럼(evidence_kind_source)이 없는 현재 스키마에서는 구분해 저장할 수 없으므로 **null 강제**한다.
  //  - participant 경로: 본인이 고른 값 그대로 저장.
  //  - operator 본인 발언(authorParticipantId 없음): 대리 귀속이 아니므로 저장 허용.
  //  - operator 대리입력(authorParticipantId 지정): null.
  const isProxyEntry = envelope.actor.role !== 'participant' && authorParticipantId != null
  const evidenceKind = isProxyEntry ? null : (input.evidenceKind ?? null)
  const row = await statements.submit(ctx, {
    session_id: sessionId,
    round_id: input.roundId ?? null,
    group_id: input.groupId ?? null,
    author_participant_id: authorParticipantId,
    body: input.body,
    visibility: input.visibility ?? 'group',
    evidence_kind: evidenceKind
  })
  return { data: { statementId: row.id }, summary: `statement submitted ${row.id}` }
}

const ModerateStatementInput = z.object({
  statementId: z.string(),
  action: ModerationActionEnum,
  reason: z.string().optional()
})

// Operator gate 는 "운영자 권한 집합"만 검증하고 admin/instructor/assistant 세부 role 은
// 클라이언트가 주장한 값이다. 없는 정보를 감사 로그에 있는 척 저장하지 않기 위해 operator 로 정규화한다 (M3).
export const moderateStatement: Handler = async ({ envelope }) => {
  const input = ModerateStatementInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await statements.moderate(ctx, input.statementId, input.action, 'operator', input.reason ?? '')
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

// ============================================================
// Q2 — 사후 "검토가 필요한 주장" 후보 (DELIBERATION-QUALITY-PLAN §2 Q2 · §3)
// computeSnapshot 과 **완전히 분리된 경로**다. computeSnapshot 은 현장에서 결과판을 띄우는
// 동기 액션이므로 여기에 LLM 을 붙이면 진행이 멈춘다 (§3 v1 오류 정정).
// 이 액션은 세션 후 배치로 호출되며, 실패해도 결과판·리포트는 AI 섹션 없이 정상 발행된다.
// ============================================================

const ComputeAiObservationsInput = z.object({
  sessionId: z.string(),
  roundId: z.string().optional(),
  // 미지정이면 env(DELIB_AI_PROVIDER) → 기본 'stub'. stub 은 LLM 호출 0(API 비용 0).
  provider: z.enum(['stub', 'local', 'external']).optional()
})

// M6 랭킹 상한 — 퍼실리테이터 검토 피로를 감안한 "상위 소수"(§2 Q2, ClaimBuster 근거).
const MAX_AI_OBSERVATIONS = 10

// M6 랭킹 점수 — 결정론적이어야 한다(같은 입력이면 언제나 같은 순서). 무작위·시간 의존 금지.
// 수치 주장은 사후 확인이 실제로 가능한 지점이므로 가중치를 크게 준다.
const RANK_NUMERIC_CLAIM = /\d+(?:[.,]\d+)?\s*(?:%|퍼센트|배|명|억|만|천|원|건|년|개)/g

function candidateScore(candidate: { statementId: string; kind: string }, body: string): number {
  // provider 가 자체 score 를 실어 보내면 그것을 우선한다 (현재 stub 은 보내지 않는다).
  const raw = (candidate as { score?: unknown }).score
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const numericClaims = body.match(RANK_NUMERIC_CLAIM)?.length ?? 0
  // 길이는 0~1 로 정규화해 수치 주장 1건(2점)을 절대 뒤집지 못하게 한다.
  return numericClaims * 2 + Math.min(body.length, 200) / 200
}

// operator 전용 (permissions). 후보는 전부 pending 으로 저장되고,
// 퍼실리테이터가 승인한 것만 리포트에 실린다 — 참가자 화면·프로젝터에는 어떤 경로로도 나가지 않는다.
export const computeAiObservations: Handler = async ({ envelope }) => {
  const input = ComputeAiObservationsInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const session = await sessions.findById(ctx, input.sessionId)
  if (!session) throw new Error('delib: session not found')
  const provider = resolveProvider(input.provider)
  // 오프사이트 처리 동의 게이트 — 동의(또는 env 설정) 없이 external 은 서버가 거부한다.
  const { offsiteProcessing } = readRecordingConsent(session.metadata)
  assertProviderAllowed(provider, { offsiteProcessing })

  // 후보 대상은 visible 발언만 — hidden/flagged 는 집계와 마찬가지로 제외한다 (M-1).
  const rows = await statements.list(ctx, input.sessionId, input.roundId, { visibleOnly: true })

  // M2 (Q1→Q2 결합 해제): provider 에 evidenceKind 를 넘기지 않는다 — 항상 null.
  // 결합하면 정직하게 '추정'을 고른 사람만 리포트 후보로 뽑히고, 2회차부터 아무도 '추정'을 고르지 않는다
  // → §5 kill 지표('추정' 비율)가 설계된 인센티브로 발동한다. Q1 태그는 후보 선정에 쓰지 않고
  //   퍼실리테이터 화면의 참고 표시로만 쓴다 (docs/DELIBERATION-QUALITY-PLAN.md §2 Q1·Q2).
  const candidates = await analyzeStatements({
    provider,
    offsiteProcessing,
    statements: rows.map((s) => ({ id: s.id, body: s.body, evidenceKind: null }))
  })

  // M5 (순서 수정): 예전에는 analyze 전에 deletePending 을 불러서, provider 가 실패하면
  // 퍼실리테이터의 기존 검토 큐가 통째로 사라지고 ok 가 반환됐다.
  // 후보가 0건이면 **아무것도 지우지 않고** 조기 반환한다.
  if (candidates.length === 0) {
    return {
      data: {
        sessionId: input.sessionId,
        provider,
        analyzedCount: rows.length,
        candidateCount: 0,
        // 발언은 있는데 후보가 0건인 상황은 provider 실패와 "해당 없음"을 구분할 수 없다.
        // 보수적으로 실패 가능성을 신호하고 기존 pending 을 보존한다.
        providerFailed: rows.length > 0,
        pendingPreserved: true
      },
      summary: `ai observations computed 0/${rows.length} (${provider}) — pending preserved`
    }
  }

  // M6 (랭킹): provider 는 입력 순서대로 돌려주므로 상한(10)에 걸리면 **먼저 제출한 사람**이
  // 체계적으로 불리해진다. 계획서(§2 Q2)의 근거는 ClaimBuster "랭킹 상위 소수"이므로
  // 저장 전에 결정론적으로 정렬한 뒤 상한에서 자른다.
  // 정렬 키(전부 결정론적):
  //   1) provider 가 score 를 돌려줬으면 score desc (현재 stub 은 없음 — 외부 provider 대비)
  //   2) 없으면 검증 가능성 대리지표: 수치 주장 수(2점/건) + 본문 길이 정규화(0~1) desc
  //   3) statementId 사전순 → kind 사전순 (완전 동점에서도 순서가 고정된다)
  // 주의: provider 내부에서 이미 10건으로 잘린 뒤라 여기서의 정렬은 "잘린 집합 안"에서만 유효하다.
  //       provider 측 상한 제거는 별도 레인(aiProvider.ts) 소관.
  const bodyById = new Map(rows.map((s) => [s.id, s.body] as const))
  const ranked = candidates
    .map((c) => ({ c, score: candidateScore(c, bodyById.get(c.statementId) ?? '') }))
    .sort((a, b) =>
      b.score - a.score ||
      a.c.statementId.localeCompare(b.c.statementId) ||
      a.c.kind.localeCompare(b.c.kind)
    )
    .slice(0, MAX_AI_OBSERVATIONS)
    .map((r) => r.c)

  // 재계산 시 미검토(pending) 후보만 정리한다. 승인·기각 이력은 감사 근거로 보존.
  await aiObservations.deletePending(ctx, input.sessionId, input.roundId ?? null)
  const roundById = new Map(rows.map((s) => [s.id, s.round_id] as const))
  // 이미 검토된(승인·기각) 조합은 다시 후보로 만들지 않는다 — 기각은 영구 제외이고,
  // 재계산이 퍼실리테이터에게 같은 항목을 반복 제시하면 검토 피로만 늘어난다.
  const reviewedKeys = new Set(
    (await aiObservations.list(ctx, input.sessionId))
      .filter((o) => o.status !== 'pending')
      .map((o) => `${o.statement_id}:${o.kind}`)
  )
  const saved = await aiObservations.insertMany(
    ctx,
    ranked.filter((c) => !reviewedKeys.has(`${c.statementId}:${c.kind}`)).map((c) => ({
      session_id: input.sessionId,
      round_id: roundById.get(c.statementId) ?? input.roundId ?? null,
      statement_id: c.statementId,
      kind: c.kind,
      body: c.body,
      suggested_question: c.suggestedQuestion,
      provider
    }))
  )
  return {
    data: {
      sessionId: input.sessionId,
      provider,
      analyzedCount: rows.length,
      candidateCount: saved.length,
      providerFailed: false,
      pendingPreserved: false
    },
    summary: `ai observations computed ${saved.length}/${rows.length} (${provider})`
  }
}

const ReviewAiObservationInput = z.object({
  observationId: z.string(),
  decision: z.enum(['approve', 'reject']),
  // §5 지표(오탐 신고율) 실측용 — 선택 입력.
  reason: z.string().optional()
})

// 퍼실리테이터 승인/기각. approved 만 리포트에 실리고, rejected 는 영구 제외된다.
export const reviewAiObservation: Handler = async ({ envelope }) => {
  const input = ReviewAiObservationInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const status = input.decision === 'approve' ? 'approved' : 'rejected'
  // Operator gate 가 확인한 것은 세부 role 이 아니라 운영자 권한 집합이다. 감사 필드도 그 사실만 기록한다 (M3).
  const row = await aiObservations.review(ctx, input.observationId, status, 'operator', input.reason ?? '')
  if (!row) throw new Error('delib: ai observation not found')
  return { data: { observationId: row.id, status: row.status }, summary: `ai observation ${row.id} ${row.status}` }
}
