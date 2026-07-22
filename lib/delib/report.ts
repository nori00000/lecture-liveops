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
import { sessions, participants, delibRounds, statements, votes, landscape } from '@/lib/db/repo'
import { computeSnapshotPayload, type StatementMetric, type MinorityFlag, type SnapshotPayload } from './metrics'
import type { RoundMode, RoundStatus, ModerationState, ModerationAction, Role, LandscapeSnapshot } from '@/lib/db/schema'

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

  const reportRounds: ReportRound[] = rounds.map((r) => {
    const published = publishedByRound.get(r.id)
    if (published) {
      // 발행 스냅샷 저장값 신뢰 (computeSnapshotPayload 와 동일 계산이므로 재집계하지 않는다).
      const payload = published.payload as unknown as SnapshotPayload
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
        published: true
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
      published: false
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
    rawData
  }
}
