// Lecture LiveOps — 숙의 워크숍 납품 리포트 데이터 조립 (deliberation workshop report)
// PRODUCT-PLAN-v2 §3 "3단계 결과판·리포트": 제품 차별점인 "절차 증빙형 납품물"의 실체.
//
// 핵심 원칙:
//  - 모든 결과 항목은 원 statementId/roundId 에 연결된다 (traceability). 결론은 원자료로 되짚을 수 있어야 한다.
//  - 개인 투표 원자료는 리포트에 절대 담지 않는다 — statement 별 집계(tally)만 (거버넌스 §7-2).
//  - k-익명 억제(computeSnapshotPayload.suppressed)는 리포트에서도 "표본 부족"으로 표기한다 (M-9).
//  - 익명 모드면 원자료 섹션의 참가자 alias 를 anon_handle 로 마스킹한다 (§7-2/M4).

import type { RlsContext } from '@/lib/db/neonHelpers'
import { sessions, participants, delibRounds, statements, votes } from '@/lib/db/repo'
import { computeSnapshotPayload, type StatementMetric, type MinorityFlag } from './metrics'
import type { RoundMode, RoundStatus, ModerationState, ModerationAction, Role } from '@/lib/db/schema'

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

  // 참가자 alias 맵 — 익명 모드면 anon_handle, 아니면 display_alias.
  const aliasById = new Map<string, string>()
  for (const p of parts) {
    const alias = anonymousMode
      ? (p.anon_handle || p.id.slice(0, 6))
      : (p.display_alias || p.anon_handle || p.id.slice(0, 6))
    aliasById.set(p.id, alias)
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
    const authorAlias = s.author_participant_id
      ? (aliasById.get(s.author_participant_id) ?? s.author_participant_id.slice(0, 6))
      : '(운영자 대리)'
    return {
      statementId: s.id,
      roundId: s.round_id,
      groupId: s.group_id,
      authorAlias,
      body: s.body,
      moderationState: s.moderation_state,
      agree: m?.agree ?? 0,
      disagree: m?.disagree ?? 0,
      pass: m?.pass ?? 0,
      total: m?.total ?? 0,
      suppressed: m?.suppressed ?? false
    }
  })

  // ── 라운드별 결과: 각 라운드의 visible 발언만으로 consensus/divisive/minority 계산.
  // compute_snapshot 핸들러와 동일하게 visible 만 집계 대상 (hidden/flagged 제외, M-1).
  const reportRounds: ReportRound[] = rounds.map((r) => {
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
      minority: payload.minority.map((m) => toResultItem(m, bodyById, roundById))
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
      generatedAt: new Date().toISOString()
    },
    procedure,
    rounds: reportRounds,
    moderation: { total: events.length, byAction, events },
    rawData
  }
}
