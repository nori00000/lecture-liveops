// Lecture LiveOps — 숙의 워크숍 납품 리포트 데이터 조립 (deliberation workshop report)
// PRODUCT-PLAN-v2 §3 "3단계 결과판·리포트": 제품 차별점인 "절차 증빙형 납품물"의 실체.
//
// 핵심 원칙:
//  - 모든 결과 항목은 원 statementId/roundId 에 연결된다 (traceability). 결론은 원자료로 되짚을 수 있어야 한다.
//  - 개인 투표 원자료는 리포트에 절대 담지 않는다 — statement 별 집계(tally)만 (거버넌스 §7-2).
//  - k-익명 억제(computeSnapshotPayload.suppressed)는 리포트에서도 "표본 부족"으로 표기한다 (M-9).
//  - 익명 모드면 원자료 섹션의 작성자 컬럼을 '익명'으로 고정한다 (§7-2/M4, F4). 반복 핸들로 작성자별 발언을 연결하지 못하게 비연결 처리하고 traceability 는 statementId 로만 유지한다.
//  - 숨김(hidden) 처리된 발언은 원자료 body 를 마스킹한다 (F1). moderation 사실·집계·이벤트 요약은 남긴다.
//  - 결과 섹션은 발행된(published) 스냅샷이 있으면 그 저장 payload 를 신뢰한다 (F3). 발행 시점 집계와 리포트가 어긋나지 않게 한다.

import type { RlsContext } from '@/lib/db/neonHelpers'
import { sessions, participants, delibRounds, statements, votes, landscape, aiObservations } from '@/lib/db/repo'
import {
  computeSnapshotPayload,
  computeEvidenceKindDistribution,
  type StatementMetric,
  type MinorityFlag,
  type EvidenceKindBreakdown
} from './metrics'
import {
  explainedVarianceWarning,
  landscapeReasonText,
  stabilityWarning,
  type GicClusterStat,
  type LandscapeResult,
  type LiftBucket,
  type PermutationTest,
  type SnapshotPayloadWithLandscape
} from './landscapeMetrics'
import type { RoundMode, RoundStatus, ModerationState, ModerationAction, Role, LandscapeSnapshot, AiObservationKind } from '@/lib/db/schema'

// Q2: 리포트에 실리는 "검토가 필요한 주장" 1건 (DELIBERATION-QUALITY-PLAN §2 Q2).
// **퍼실리테이터가 승인(approved)한 것만** 여기에 들어온다 — pending/rejected 는 영구 제외.
// AI 생성물임을 라벨로 명시하고(§7-5), 원 statementId 로 되짚을 수 있게 한다(traceability).
export type ReportAiObservation = {
  observationId: string
  statementId: string
  roundId: string | null
  kind: AiObservationKind
  // "근거 확인이 필요해 보입니다" 톤의 관찰 문구. 개인·진영 라벨 없음.
  body: string
  suggestedQuestion: string
  // 원 발언 본문 (숨김 처리된 발언은 애초에 이 섹션에 오지 않는다).
  statementBody: string
  reviewedAt: string | null
  provider: string
}

// 결과 항목 — consensus/divisive/minority 랭킹 1건. 원 statementId/roundId 로 되짚을 수 있다 (traceability).
export type ReportResultItem = {
  statementId: string
  roundId: string | null
  groupId: string | null
  body: string
  agree: number
  disagree: number
  pass: number
  total: number
  agreeRate: number
  consensusScore: number
  divisiveScore: number
  // 소수의견에만 존재 — 전체 다수 방향과의 표차 |찬-반|.
  margin?: number
}

// Post-MVP B: 라운드별 의견 지형 요약. 발행 스냅샷 payload.landscape 를 리포트용으로 옮긴 것.
// 좌표(projection)는 리포트에 싣지 않는다 — 클러스터 규모·GIC·대표의견만 (납품물에 산점도 좌표는 불필요).
export type ReportLandscape = {
  enabled: boolean
  // 비활성 사유 문구 (활성이면 없음).
  reasonText?: string
  participantCount: number
  eligibleCount: number
  k: number
  silhouette: number
  // C3: 2D 좌표 설명분산 + 낮을 때의 경고 문구.
  explainedVarianceRatio: number
  varianceWarning: string | null
  // H5: leave-one-out 안정성 경고 문구.
  stabilityWarning: string | null
  // C2: 순열검정 요약 (관측 실루엣 / null 95th / p).
  permutation: PermutationTest | null
  // C5: 응답 회피가 높은 발언 — 클러스터링에서 제외되었지만 회피 자체가 정보다.
  avoidedStatements: Array<{ statementId: string; body: string; missingRate: number; votes: number }>
  analyzedStatementCount: number
  clusters: Array<{ id: number; size: number }>
  gic: Array<{ statementId: string; body: string; score: number; perCluster: GicClusterStat[] }>
  representatives: Array<{
    clusterId: number
    statementId: string
    body: string
    lift: number
    agreeRate: number
    insideVotes: number
    pAdjusted: number
    test: 'z' | 'fisher'
    rank: number
    bucket: LiftBucket
  }>
}

export type ReportRound = {
  roundId: string
  roundIndex: number
  title: string
  mode: RoundMode
  status: RoundStatus
  // 이 라운드의 집계 대상(visible) 발언 수.
  statementCount: number
  consensus: ReportResultItem[]
  divisive: ReportResultItem[]
  minority: ReportResultItem[]
  // F3: 결과 근거가 된 스냅샷 출처. published 면 발행 스냅샷 저장값, 아니면 리포트 생성 시점 재집계.
  snapshotId: string | null
  computedAt: string
  publishedAt: string | null
  published: boolean
  // 의견 지형 — 발행 스냅샷에 계산 결과가 있을 때만. 없으면 null(미계산).
  landscape: ReportLandscape | null
  // Q1: 근거 유형 분포 (참가자 자기 태깅). 개인 단위 없음 — 그룹 기여자 k(3) 미만은 억제.
  evidenceKind: EvidenceKindBreakdown
}

// 원자료 섹션의 발언 1건 — statement 별 집계(개인 표 없음). k-익명 억제·익명 마스킹 반영.
export type ReportRawStatement = {
  statementId: string
  roundId: string | null
  groupId: string | null
  // 익명 모드면 anon_handle, 아니면 display_alias. 운영자 대리 발언(author 없음)은 '(운영자 대리)'.
  authorAlias: string
  body: string
  moderationState: ModerationState
  agree: number
  disagree: number
  pass: number
  total: number
  // true 면 k-익명 억제 — 표본 부족으로 집계값 미노출 (수치는 0 마스킹).
  suppressed: boolean
}

export type ReportModerationEvent = {
  statementId: string
  action: ModerationAction
  actorRole: Role
  reason: string
  createdAt: string
}

export type ReportModeration = {
  total: number
  byAction: Record<ModerationAction, number>
  events: ReportModerationEvent[]
}

export type WorkshopReport = {
  overview: {
    sessionId: string
    title: string
    date: string
    venue: string
    participantCount: number
    roundCount: number
    statementCount: number
    generatedAt: string
  }
  // 절차 설정 (privacy_settings) — 익명여부·공개범위·보관기간·미성년자·사전합의.
  procedure: {
    anonymousMode: boolean
    disclosure: string
    retentionDays: number | null
    minorSession: boolean
    consentConfirmed: boolean
  }
  rounds: ReportRound[]
  moderation: ReportModeration
  rawData: ReportRawStatement[]
  // Q2: 승인된 "검토가 필요한 주장"만. 0건이면 빈 배열이고 포맷터는 섹션 자체를 넣지 않는다.
  aiObservations: ReportAiObservation[]
}

// StatementMetric → ReportResultItem. body/round/group 은 발언 메타에서 채운다.
function toResultItem(
  m: StatementMetric | MinorityFlag,
  bodyById: Map<string, string>,
  roundById: Map<string, string | null>
): ReportResultItem {
  return {
    statementId: m.statementId,
    roundId: roundById.get(m.statementId) ?? null,
    groupId: m.groupId,
    body: bodyById.get(m.statementId) ?? '',
    agree: m.agree,
    disagree: m.disagree,
    pass: m.pass,
    total: m.total,
    agreeRate: m.agreeRate,
    consensusScore: m.consensusScore,
    divisiveScore: m.divisiveScore,
    ...('margin' in m ? { margin: m.margin } : {})
  }
}

// 스냅샷 payload.landscape → 리포트용 요약. 좌표는 버리고 규모·GIC·대표의견만 남긴다.
function toReportLandscape(ls: LandscapeResult | undefined, bodyById: Map<string, string>): ReportLandscape | null {
  if (!ls) return null
  // C5: 회피 발언은 활성/비활성과 무관하게 항상 노출한다 (삭제가 아니라 별도 표기).
  const avoidedStatements = (ls.missingness ?? [])
    .filter((m) => m.excluded)
    .map((m) => ({
      statementId: m.statementId,
      body: bodyById.get(m.statementId) ?? '',
      missingRate: m.missingRate,
      votes: m.votes
    }))
  const base = {
    participantCount: ls.participantCount,
    eligibleCount: ls.eligibleCount,
    k: ls.k,
    silhouette: ls.silhouette,
    explainedVarianceRatio: ls.explainedVarianceRatio ?? 0,
    varianceWarning: explainedVarianceWarning(ls),
    stabilityWarning: stabilityWarning(ls),
    permutation: ls.permutation ?? null,
    avoidedStatements,
    analyzedStatementCount: ls.analyzedStatementCount ?? 0,
    clusters: (ls.clusters ?? []).map((c) => ({ id: c.id, size: c.size }))
  }
  if (!ls.enabled) {
    return { enabled: false, reasonText: landscapeReasonText(ls), ...base, gic: [], representatives: [] }
  }
  return {
    enabled: true,
    ...base,
    gic: (ls.gic ?? []).map((g) => ({
      statementId: g.statementId,
      body: bodyById.get(g.statementId) ?? '',
      score: g.score,
      perCluster: g.perCluster ?? []
    })),
    representatives: (ls.representatives ?? []).map((r) => ({
      clusterId: r.clusterId,
      statementId: r.statementId,
      body: bodyById.get(r.statementId) ?? '',
      lift: r.lift,
      agreeRate: r.agreeRate,
      insideVotes: r.insideVotes,
      pAdjusted: r.pAdjusted,
      test: r.test,
      rank: r.rank,
      bucket: r.bucket
    }))
  }
}

// 세션 metadata 의 privacy_settings 를 안전하게 읽는다 (없거나 형태 불일치면 기본값).
function readProcedure(metadata: Record<string, unknown> | undefined): WorkshopReport['procedure'] {
  const ps = metadata?.privacy_settings
  const obj = ps && typeof ps === 'object' ? (ps as Record<string, unknown>) : {}
  return {
    anonymousMode: obj.anonymousMode === true,
    disclosure: typeof obj.disclosure === 'string' ? obj.disclosure : 'operators_only',
    retentionDays: typeof obj.retentionDays === 'number' ? obj.retentionDays : null,
    minorSession: obj.minorSession === true,
    consentConfirmed: obj.consentConfirmed === true
  }
}

// 워크숍 리포트 데이터 조립 — 행사 개요·절차 설정·라운드별 결과·moderation·원자료.
// operator 경로에서만 호출해야 한다 (개인 표 원자료는 담지 않지만 원 발언 body 를 포함).
export async function buildWorkshopReport(ctx: RlsContext, sessionId: string): Promise<WorkshopReport | null> {
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return null

  const [parts, rounds, allStatements] = await Promise.all([
    participants.list(ctx, sessionId),
    delibRounds.list(ctx, sessionId),
    statements.list(ctx, sessionId)
  ])

  const procedure = readProcedure(session.metadata)
  const anonymousMode = procedure.anonymousMode
  const generatedAt = new Date().toISOString()

  // 기명 모드 원자료 작성자 표기용 맵 (display_alias). 익명 모드에서는 작성자 컬럼을 '익명'으로 고정하므로(F4) 쓰지 않는다.
  const displayAliasById = new Map<string, string>()
  for (const p of parts) {
    displayAliasById.set(p.id, p.display_alias || p.anon_handle || p.id.slice(0, 6))
  }

  // 발언 메타 조회용 맵 (body / round). traceability: 결과 → statementId → body/round.
  const bodyById = new Map(allStatements.map((s) => [s.id, s.body] as const))
  const roundById = new Map(allStatements.map((s) => [s.id, s.round_id] as const))

  // 집계는 tally 함수(개인 표 미노출)로만. 전체 발언에 대해 한 번에.
  const tallies = await votes.tallyByStatements(ctx, allStatements.map((s) => s.id))

  // ── 원자료 섹션: 전체 발언(moderation 상태 포함) statement 별 집계 + k-익명 억제.
  // computeSnapshotPayload 의 suppressed 를 재사용해 리포트에서도 동일한 "표본 부족" 판정을 쓴다.
  const rawPayload = computeSnapshotPayload(
    allStatements.map((s) => ({ id: s.id, group_id: s.group_id })),
    tallies
  )
  const rawMetricById = new Map(rawPayload.statements.map((m) => [m.statementId, m] as const))
  const rawData: ReportRawStatement[] = allStatements.map((s) => {
    const m = rawMetricById.get(s.id)
    // F4: 익명 모드면 작성자 컬럼을 '익명'으로 고정해 반복 핸들(anon_handle)·participantId 로 작성자별 발언을 연결하지 못하게 한다.
    //     운영자 대리 발언은 원래 author 가 없으므로 그대로 '(운영자 대리)'.
    const authorAlias = s.author_participant_id
      ? (anonymousMode ? '익명' : (displayAliasById.get(s.author_participant_id) ?? s.author_participant_id.slice(0, 6)))
      : '(운영자 대리)'
    // F1: 숨김(hidden) 발언은 body 를 마스킹한다 (신고됨/flagged 는 상태 라벨만 유지하고 body 는 보존).
    //     moderation 사실(moderationState)·집계·이벤트 요약은 남긴다.
    const body = s.moderation_state === 'hidden' ? '(운영자가 숨김 처리한 발언)' : s.body
    return {
      statementId: s.id,
      roundId: s.round_id,
      groupId: s.group_id,
      authorAlias,
      body,
      moderationState: s.moderation_state,
      agree: m?.agree ?? 0,
      disagree: m?.disagree ?? 0,
      pass: m?.pass ?? 0,
      total: m?.total ?? 0,
      suppressed: m?.suppressed ?? false
    }
  })

  // ── F3: 라운드별 결과의 근거 스냅샷 선택.
  // 발행된(published_at != null) 스냅샷이 있으면 그 저장 payload 를 결과 섹션 기준으로 쓴다 (발행 시점 집계 == 프로젝터/결과판).
  // landscape.list 는 computed_at desc 정렬이므로 라운드별 첫 published 스냅샷이 최신 발행본이다.
  const snapshots = await landscape.list(ctx, sessionId)
  const publishedByRound = new Map<string, LandscapeSnapshot>()
  for (const snap of snapshots) {
    if (snap.published_at == null || snap.round_id == null) continue
    if (!publishedByRound.has(snap.round_id)) publishedByRound.set(snap.round_id, snap)
  }

  // Q1: 근거 유형 분포는 스냅샷에 저장되지 않으므로(발행 여부와 무관하게) 발언에서 직접 집계한다.
  // 집계 대상은 visible 발언만 — hidden/flagged 는 결과 집계에서 제외하는 기존 원칙(M-1)과 동일.
  const evidenceKindForRound = (roundId: string): EvidenceKindBreakdown =>
    computeEvidenceKindDistribution(
      allStatements
        .filter((s) => s.round_id === roundId && s.moderation_state === 'visible')
        .map((s) => ({
          statementId: s.id,
          roundId: s.round_id,
          groupId: s.group_id,
          evidenceKind: s.evidence_kind,
          authorParticipantId: s.author_participant_id
        }))
    )

  const reportRounds: ReportRound[] = rounds.map((r) => {
    const published = publishedByRound.get(r.id)
    if (published) {
      // 발행 스냅샷 저장값 신뢰 (computeSnapshotPayload 와 동일 계산이므로 재집계하지 않는다).
      const payload = published.payload as unknown as SnapshotPayloadWithLandscape
      return {
        roundId: r.id,
        roundIndex: r.round_index,
        title: r.title,
        mode: r.mode,
        status: r.status,
        statementCount: (payload.statements ?? []).filter((m) => !m.suppressed).length,
        consensus: (payload.consensus ?? []).map((m) => toResultItem(m, bodyById, roundById)),
        divisive: (payload.divisive ?? []).map((m) => toResultItem(m, bodyById, roundById)),
        minority: (payload.minority ?? []).map((m) => toResultItem(m, bodyById, roundById)),
        snapshotId: published.id,
        computedAt: published.computed_at,
        publishedAt: published.published_at,
        published: true,
        landscape: toReportLandscape(payload.landscape, bodyById),
        evidenceKind: evidenceKindForRound(r.id)
      }
    }
    // 미발행 라운드 — 리포트 생성 시점에 현재 visible 발언으로 재집계 (hidden/flagged 제외, M-1).
    const roundStatements = allStatements.filter((s) => s.round_id === r.id && s.moderation_state === 'visible')
    const payload = computeSnapshotPayload(
      roundStatements.map((s) => ({ id: s.id, group_id: s.group_id })),
      tallies
    )
    return {
      roundId: r.id,
      roundIndex: r.round_index,
      title: r.title,
      mode: r.mode,
      status: r.status,
      statementCount: payload.statements.filter((m) => !m.suppressed).length,
      consensus: payload.consensus.map((m) => toResultItem(m, bodyById, roundById)),
      divisive: payload.divisive.map((m) => toResultItem(m, bodyById, roundById)),
      minority: payload.minority.map((m) => toResultItem(m, bodyById, roundById)),
      snapshotId: null,
      computedAt: generatedAt,
      publishedAt: null,
      published: false,
      // 의견 지형은 스냅샷 계산 시점(개인 표 행렬 접근 경로)에서만 만들어진다.
      // 리포트 생성 시점 재집계 경로에서는 개인 표를 읽지 않으므로 null(미계산).
      landscape: null,
      evidenceKind: evidenceKindForRound(r.id)
    }
  })

  // ── moderation 내역: 발언별 moderation_events 를 모아 요약.
  const eventLists = await Promise.all(allStatements.map((s) => statements.listModerationEvents(ctx, s.id)))
  const byAction: Record<ModerationAction, number> = { flag: 0, hide: 0, restore: 0, approve: 0 }
  const events: ReportModerationEvent[] = []
  for (const list of eventLists) {
    for (const e of list) {
      byAction[e.action] = (byAction[e.action] ?? 0) + 1
      events.push({ statementId: e.statement_id, action: e.action, actorRole: e.actor_role, reason: e.reason, createdAt: e.created_at })
    }
  }
  events.sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  // ── Q2: 승인된 검토 후보. AI 는 크리티컬 패스가 아니다 —
  // 조회가 실패해도 리포트는 AI 섹션 없이 정상 발행된다 (§3).
  const statementById = new Map(allStatements.map((s) => [s.id, s] as const))
  let reportAiObservations: ReportAiObservation[] = []
  try {
    const approved = await aiObservations.list(ctx, sessionId, { status: 'approved' })
    reportAiObservations = approved.flatMap((o) => {
      const s = statementById.get(o.statement_id)
      // 승인 후에 숨김 처리된 발언은 싣지 않는다 (F1 마스킹 원칙과 동일).
      if (!s || s.moderation_state === 'hidden') return []
      return [{
        observationId: o.id,
        statementId: o.statement_id,
        roundId: o.round_id ?? s.round_id,
        kind: o.kind,
        body: o.body,
        suggestedQuestion: o.suggested_question,
        statementBody: s.body,
        reviewedAt: o.reviewed_at,
        provider: o.provider
      }]
    })
  } catch (e) {
    console.error(`[delib-report] ai observations unavailable: ${e instanceof Error ? e.name : 'unknown'}`)
  }

  return {
    overview: {
      sessionId: session.id,
      title: session.title,
      date: session.date,
      venue: session.venue,
      participantCount: parts.length,
      roundCount: rounds.length,
      statementCount: allStatements.length,
      generatedAt
    },
    procedure,
    rounds: reportRounds,
    moderation: { total: events.length, byAction, events },
    rawData,
    aiObservations: reportAiObservations
  }
}
