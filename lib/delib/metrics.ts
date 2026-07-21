// Lecture LiveOps — 숙의 스냅샷 지표 (deliberation metrics)
// PRODUCT-PLAN-v2 §3: 합의 강도·찬반유보율·그룹 간 편차·소수의견 flag.
// 명시적 금지: PCA/K-means 클러스터링 (§3 명시적 제외). 여기 있는 건 전부 결정적 집계·랭킹뿐.

import type { VoteValue } from '@/lib/db/schema'

export type StatementMeta = {
  id: string
  group_id?: string | null
}

export type Tally = { agree: number; disagree: number; pass: number }

export type Leaning = 'agree' | 'disagree' | 'tie'

export type StatementMetric = {
  statementId: string
  groupId: string | null
  agree: number
  disagree: number
  pass: number
  total: number
  // 찬성률 = agree / 전체 표수(유보 포함). 표 0건이면 0.
  agreeRate: number
  // 순찬성 = agree - disagree
  net: number
  leaning: Leaning
  // 합의 강도 = |찬-반| / (찬+반). 한쪽으로 쏠릴수록 1에 가까움. (유보 제외)
  consensusScore: number
  // 찬반 갈림 = 1 - 합의강도. 팽팽할수록 1에 가까움.
  divisiveScore: number
}

export type MinorityFlag = StatementMetric & {
  // 전체 다수 방향과 반대 방향인 발언. margin = |찬-반| (표차).
  margin: number
}

export type GroupDeviation = {
  groups: Array<{ groupId: string; statementCount: number; avgAgreeRate: number; avgNet: number }>
  // 그룹 간 찬성률 편차 (표준편차 / 최대-최소 spread)
  agreeRateStdDev: number
  agreeRateSpread: number
}

export type SnapshotPayload = {
  statements: StatementMetric[]
  overall: { agree: number; disagree: number; pass: number; leaning: Leaning }
  consensus: StatementMetric[]
  divisive: StatementMetric[]
  minority: MinorityFlag[]
  groupDeviation: GroupDeviation
}

export type ComputeOptions = {
  // 소수의견 flag 최소 표차 (기본 1). |찬-반| 이 이 값 미만이면 flag 하지 않는다.
  minorityMarginThreshold?: number
}

function leaningOf(agree: number, disagree: number): Leaning {
  if (agree > disagree) return 'agree'
  if (disagree > agree) return 'disagree'
  return 'tie'
}

function metricFor(meta: StatementMeta, tally: Tally): StatementMetric {
  const agree = tally.agree
  const disagree = tally.disagree
  const pass = tally.pass
  const total = agree + disagree + pass
  const sided = agree + disagree
  const agreeRate = total > 0 ? agree / total : 0
  const net = agree - disagree
  const consensusScore = sided > 0 ? Math.abs(agree - disagree) / sided : 0
  return {
    statementId: meta.id,
    groupId: meta.group_id ?? null,
    agree,
    disagree,
    pass,
    total,
    agreeRate,
    net,
    leaning: leaningOf(agree, disagree),
    consensusScore,
    divisiveScore: sided > 0 ? 1 - consensusScore : 0
  }
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function computeSnapshotPayload(
  statementsMeta: StatementMeta[],
  tallies: Record<string, Tally>,
  options: ComputeOptions = {}
): SnapshotPayload {
  const threshold = options.minorityMarginThreshold ?? 1

  const metrics = statementsMeta.map((m) => metricFor(m, tallies[m.id] ?? { agree: 0, disagree: 0, pass: 0 }))

  // 전체 집계 + 전체 다수 방향
  const overallAgree = metrics.reduce((a, m) => a + m.agree, 0)
  const overallDisagree = metrics.reduce((a, m) => a + m.disagree, 0)
  const overallPass = metrics.reduce((a, m) => a + m.pass, 0)
  const overallLeaning = leaningOf(overallAgree, overallDisagree)

  // consensus 랭킹 — 합의 강도 높은 순 (표가 있는 발언만). 동점은 표수 많은 순.
  const consensus = metrics
    .filter((m) => m.agree + m.disagree > 0)
    .slice()
    .sort((a, b) => b.consensusScore - a.consensusScore || b.total - a.total)

  // divisive 랭킹 — 찬반 팽팽한 순 (양쪽 다 표가 있는 발언만).
  const divisive = metrics
    .filter((m) => m.agree > 0 && m.disagree > 0)
    .slice()
    .sort((a, b) => b.divisiveScore - a.divisiveScore || b.total - a.total)

  // 소수의견 flag — 전체 다수 방향과 반대 방향 & |표차| >= threshold.
  const minority: MinorityFlag[] = metrics
    .filter((m) => m.leaning !== 'tie' && m.leaning !== overallLeaning && Math.abs(m.net) >= threshold)
    .map((m) => ({ ...m, margin: Math.abs(m.net) }))
    .sort((a, b) => b.margin - a.margin)

  // 그룹 간 편차 — 그룹별 평균 찬성률/순찬성
  const byGroup = new Map<string, StatementMetric[]>()
  for (const m of metrics) {
    if (m.groupId == null) continue
    const arr = byGroup.get(m.groupId) ?? []
    arr.push(m)
    byGroup.set(m.groupId, arr)
  }
  const groups = [...byGroup.entries()].map(([groupId, arr]) => ({
    groupId,
    statementCount: arr.length,
    avgAgreeRate: arr.reduce((a, m) => a + m.agreeRate, 0) / arr.length,
    avgNet: arr.reduce((a, m) => a + m.net, 0) / arr.length
  }))
  const rates = groups.map((g) => g.avgAgreeRate)
  const agreeRateSpread = rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 0

  return {
    statements: metrics,
    overall: { agree: overallAgree, disagree: overallDisagree, pass: overallPass, leaning: overallLeaning },
    consensus,
    divisive,
    minority,
    groupDeviation: { groups, agreeRateStdDev: stdDev(rates), agreeRateSpread }
  }
}

// vote 값 배열 → Tally (테스트/집계 helper)
export function tallyVotes(voteList: VoteValue[]): Tally {
  const t: Tally = { agree: 0, disagree: 0, pass: 0 }
  for (const v of voteList) {
    if (v === 'agree') t.agree += 1
    else if (v === 'disagree') t.disagree += 1
    else t.pass += 1
  }
  return t
}
