// Lecture LiveOps — 숙의 스냅샷 지표 (deliberation metrics)
// PRODUCT-PLAN-v2 §3: 합의 강도·찬반유보율·그룹 간 편차·소수의견 flag.
// 이 모듈은 결정적 집계·랭킹만 담당한다. PCA/K-means 클러스터링은 MVP 범위에서 제외했던 항목이라
// 여기에 섞지 않고 Post-MVP B 에서 별도 모듈(lib/delib/clustering.ts, landscapeMetrics.ts)로 분리했다.
// 클러스터링은 순수 추가 레이어이며 아래 consensus/divisive/minority 동작에 영향을 주지 않는다.

import type { VoteValue, EvidenceKind } from '@/lib/db/schema'

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
  // 쏠림 강도 = |찬-반| / (찬+반). 한쪽으로 쏠릴수록 1에 가까움. (유보 제외)
  // **방향을 구분하지 않는다** — 찬 16/반 4 와 찬 4/반 16 이 똑같이 0.6 이다.
  // 방향은 반드시 net/leaning 으로 함께 읽어야 한다. 이 값 단독으로 "합의점"이라 부르면 안 된다
  // (반대 다수 발언이 합의점으로 표기되던 결함의 원인).
  consensusScore: number
  // 찬반 갈림 = 1 - 합의강도. 팽팽할수록 1에 가까움.
  divisiveScore: number
  // k-익명 억제 (M-9): 0 < 총표수 < k 이면 개인 표 역추론 위험 → 집계값 노출 억제.
  // suppressed=true 이면 수치는 전부 0 으로 마스킹되고 랭킹·전체집계에서 제외된다.
  suppressed: boolean
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
  // 찬성 방향으로 합의된 발언 (net > 0). "합의점"으로 표기해도 되는 유일한 목록.
  consensus: StatementMetric[]
  // 반대 방향으로 합의된 발언 (net < 0). 합의는 합의지만 방향이 반대 — 별도 목록으로 분리한다.
  // 이걸 consensus 에 섞으면 "찬 4 / 반 16" 이 합의점으로 납품된다.
  opposed: StatementMetric[]
  // 쏠림이 합의 임계에 못 미친 발언. consensus/opposed 와 상호배타.
  divisive: StatementMetric[]
  minority: MinorityFlag[]
  groupDeviation: GroupDeviation
}

export type ComputeOptions = {
  // 소수의견 flag 최소 표차 (기본 2). |찬-반| 이 이 값 미만이면 flag 하지 않는다.
  // 기본 1 은 표차 1 짜리(2:1 등)까지 전부 flag 되는 no-op 이라 2 로 상향 (N-1).
  minorityMarginThreshold?: number
  // k-익명 임계 (기본 3). 총 표수가 0 초과 이 값 미만인 발언은 집계 억제 (M-9).
  kAnonymityThreshold?: number
  // 합의 판정 임계 (기본 0.5) — consensusScore 가 이 값 이상이어야 합의(찬성/반대)로 분류된다.
  // 0.5 = 다수 쪽이 유효표(찬+반)의 75% 이상. 미만은 전부 쟁점(divisive).
  consensusMinScore?: number
  // 각 랭킹 목록의 최대 건수 (기본 5). 이 컷오프가 없으면 투표가 있는 모든 발언이
  // consensus 와 divisive 양쪽에 전부 실려 "합의점과 쟁점이 같은 목록"이 된다.
  // 전량은 payload.statements 와 리포트 §원자료에 그대로 남으므로 정보 손실이 아니다.
  rankLimit?: number
}

const DEFAULT_MINORITY_MARGIN = 2
const DEFAULT_K_ANONYMITY = 3
const DEFAULT_CONSENSUS_MIN_SCORE = 0.5
const DEFAULT_RANK_LIMIT = 5

function leaningOf(agree: number, disagree: number): Leaning {
  if (agree > disagree) return 'agree'
  if (disagree > agree) return 'disagree'
  return 'tie'
}

function metricFor(meta: StatementMeta, tally: Tally, kThreshold: number): StatementMetric {
  const agree = tally.agree
  const disagree = tally.disagree
  const pass = tally.pass
  const total = agree + disagree + pass
  const groupId = meta.group_id ?? null
  // k-익명 억제: 표는 있으나 임계 미만이면 개인 표 역추론 위험 → 수치 마스킹.
  if (total > 0 && total < kThreshold) {
    return { statementId: meta.id, groupId, agree: 0, disagree: 0, pass: 0, total: 0, agreeRate: 0, net: 0, leaning: 'tie', consensusScore: 0, divisiveScore: 0, suppressed: true }
  }
  const sided = agree + disagree
  const agreeRate = total > 0 ? agree / total : 0
  const net = agree - disagree
  const consensusScore = sided > 0 ? Math.abs(agree - disagree) / sided : 0
  return {
    statementId: meta.id,
    groupId,
    agree,
    disagree,
    pass,
    total,
    agreeRate,
    net,
    leaning: leaningOf(agree, disagree),
    consensusScore,
    divisiveScore: sided > 0 ? 1 - consensusScore : 0,
    suppressed: false
  }
}

function stdDev(values: number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

type RankingLists = {
  consensus: StatementMetric[]
  opposed: StatementMetric[]
  divisive: StatementMetric[]
  minority: MinorityFlag[]
}

// 랭킹 4종을 metric 목록에서 만든다. computeSnapshotPayload 와 레거시 스냅샷 교정이 **같은 규칙**을
// 쓰도록 한 곳에 모았다 — 규칙이 두 벌이면 한쪽만 고쳐지고 발행 스냅샷이 조용히 옛 규칙으로 남는다.
function buildRankings(
  visible: StatementMetric[],
  overallLeaning: Leaning,
  opts: { consensusMin: number; rankLimit: number; minorityMargin: number }
): RankingLists {
  // 합의 판정 — 쏠림이 임계 이상인 것만. 방향(net)으로 찬성 합의 / 반대 합의를 갈라 담는다.
  // consensusScore 는 방향맹(|찬-반|)이라 이 분리 없이 랭킹하면 반대 다수 발언이 합의점에 실린다.
  const settled = visible.filter((m) => m.agree + m.disagree > 0 && m.consensusScore >= opts.consensusMin)
  const byStrength = (a: StatementMetric, b: StatementMetric) =>
    b.consensusScore - a.consensusScore || b.total - a.total

  const consensus = settled.filter((m) => m.net > 0).slice().sort(byStrength).slice(0, opts.rankLimit)
  const opposed = settled.filter((m) => m.net < 0).slice().sort(byStrength).slice(0, opts.rankLimit)

  // divisive — 합의 임계 미만 (양쪽 다 표가 있는 발언만). 위 두 목록과 상호배타.
  const divisive = visible
    .filter((m) => m.agree > 0 && m.disagree > 0 && m.consensusScore < opts.consensusMin)
    .slice()
    .sort((a, b) => b.divisiveScore - a.divisiveScore || b.total - a.total)
    .slice(0, opts.rankLimit)

  // 소수의견 flag — 전체 다수 방향과 반대 방향 & |표차| >= threshold.
  // 전체가 tie(팽팽)면 '다수 방향'이 없어 모든 발언이 소수의견으로 폭발하므로 skip (N-1).
  // **rankLimit 을 적용하지 않는다** — 거버넌스 §7-3(소수의견 보존)에서 상위 N 절단은 소수 관점을
  // 임의로 떨어뜨리는 행위가 된다. 이 목록만은 임계로만 거른다.
  const minority: MinorityFlag[] = overallLeaning === 'tie'
    ? []
    : visible
        .filter((m) => m.leaning !== 'tie' && m.leaning !== overallLeaning && Math.abs(m.net) >= opts.minorityMargin)
        .map((m) => ({ ...m, margin: Math.abs(m.net) }))
        .sort((a, b) => b.margin - a.margin)

  return { consensus, opposed, divisive, minority }
}

// 발행 스냅샷 교정 — `opposed` 가 없던 시절 저장된 payload 는 consensus 가 방향맹이고 컷오프도 없다.
// 저장값을 그대로 렌더하면 **이미 발행·납품된 세션이 계속 틀린 결과판을 보여준다**.
// 저장된 행을 고쳐 쓰는 대신(발행 스냅샷은 절차 증빙이라 사후 변조 금지) read 시점에 재분류한다.
// payload.statements 에 metric 전량이 남아 있으므로 현재 규칙으로 다시 나눌 수 있다.
// (삭제됨) normalizeSnapshotRankings — `opposed !== undefined` 로 "신규 포맷"을 판정했는데,
// 그 가드는 **필드 존재**만 보고 값의 정합성은 보지 않았다. 부분 마이그레이션이나 수기 보정으로
// `opposed: []` 가 붙은 레거시 payload 는 교정을 건너뛰어 "찬 4 / 반 16"이 합의점에 그대로 남는다.
// 신규 포맷을 다시 분류해도 같은 규칙·같은 수치라 결과가 동일하므로, 판정하지 말고 **항상**
// rerankSnapshot 을 쓴다. (Codex 적대 리뷰 2026-08-05 지적)

// 저장된 payload.statements 로 랭킹을 **항상** 다시 만든다. 집계 수치(찬/반/유보·강도)는 저장값
// 그대로이고 목록 분할만 다시 하므로, 발행 스냅샷을 신뢰한다는 원칙(F3)을 깨지 않는다.
// 쓰임새: 리포트는 화면용 상위 N 컷오프 없이 임계를 통과한 항목을 전부 실어야 한다
// (납품 문서는 스크롤이 되므로 자를 이유가 없고, 잘린 항목은 분류 없이 원자료에만 남아 증빙이 끊긴다).
export function rerankSnapshot<T extends Partial<SnapshotPayload>>(
  payload: T,
  options: ComputeOptions = {}
): T & RankingLists {
  const existing = payload as Partial<SnapshotPayload>
  // statements 가 없는 payload 는 재분류의 재료가 없다. 빈 목록으로 덮으면 이미 발행된 결과판이
  // 통째로 사라지므로, 저장된 목록을 그대로 둔다(교정 불가 상태를 지우는 것보다 낫다).
  if ((existing.statements ?? []).length === 0) {
    return {
      ...payload,
      consensus: existing.consensus ?? [],
      opposed: existing.opposed ?? [],
      divisive: existing.divisive ?? [],
      minority: existing.minority ?? []
    } as T & RankingLists
  }
  const visible = existing.statements!.filter((m) => !m.suppressed)
  const overallLeaning = existing.overall?.leaning ?? leaningOf(
    visible.reduce((a, m) => a + m.agree, 0),
    visible.reduce((a, m) => a + m.disagree, 0)
  )
  const ranked = buildRankings(visible, overallLeaning, {
    consensusMin: options.consensusMinScore ?? DEFAULT_CONSENSUS_MIN_SCORE,
    rankLimit: options.rankLimit ?? DEFAULT_RANK_LIMIT,
    minorityMargin: options.minorityMarginThreshold ?? DEFAULT_MINORITY_MARGIN
  })
  return { ...payload, ...ranked }
}

export function computeSnapshotPayload(
  statementsMeta: StatementMeta[],
  tallies: Record<string, Tally>,
  options: ComputeOptions = {}
): SnapshotPayload {
  const threshold = options.minorityMarginThreshold ?? DEFAULT_MINORITY_MARGIN
  const kThreshold = options.kAnonymityThreshold ?? DEFAULT_K_ANONYMITY
  const consensusMin = options.consensusMinScore ?? DEFAULT_CONSENSUS_MIN_SCORE
  const rankLimit = options.rankLimit ?? DEFAULT_RANK_LIMIT

  const metrics = statementsMeta.map((m) => metricFor(m, tallies[m.id] ?? { agree: 0, disagree: 0, pass: 0 }, kThreshold))
  // 억제된 발언은 랭킹·전체집계·그룹편차에서 전부 제외 (수치가 이미 0 이지만 명시 필터로 방어).
  const visible = metrics.filter((m) => !m.suppressed)

  // 전체 집계 + 전체 다수 방향 (억제 발언 제외)
  const overallAgree = visible.reduce((a, m) => a + m.agree, 0)
  const overallDisagree = visible.reduce((a, m) => a + m.disagree, 0)
  const overallPass = visible.reduce((a, m) => a + m.pass, 0)
  const overallLeaning = leaningOf(overallAgree, overallDisagree)

  const { consensus, opposed, divisive, minority } = buildRankings(visible, overallLeaning, {
    consensusMin,
    rankLimit,
    minorityMargin: threshold
  })

  // 그룹 간 편차 — 그룹별 평균 찬성률/순찬성 (억제 발언 제외)
  const byGroup = new Map<string, StatementMetric[]>()
  for (const m of visible) {
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
    opposed,
    divisive,
    minority,
    groupDeviation: { groups, agreeRateStdDev: stdDev(rates), agreeRateSpread }
  }
}

// ============================================================
// Q1 — 근거 유형 자기 태깅 분포 (DELIBERATION-QUALITY-PLAN §2 Q1 / §5 지표)
// 참가자가 스스로 고른 값만 센다. AI 판정·추론은 일절 없다(오탐 0).
// 개인 단위 노출 금지: 그룹의 **기여자 수**가 k(기본 3) 미만이면 분포를 억제한다 (§2 Q4 k-익명 규칙 준용).
// ============================================================

export type EvidenceKindItem = {
  statementId: string
  roundId?: string | null
  groupId?: string | null
  // 참가자 본인이 고른 값. 미지정(선택 안 함)은 null.
  evidenceKind?: EvidenceKind | null
  // 기여자 수 산정용. 운영자 대리입력(null)은 개인이 식별되지 않으므로 **하나의 미상 기여자**로 묶는다
  // (기여자 수를 부풀리지 않는 보수적 처리 — 억제가 더 자주 걸리는 쪽).
  authorParticipantId?: string | null
}

export type EvidenceKindCounts = {
  experience: number
  source: number
  estimate: number
  // 근거 유형을 고르지 않은 발언 (선택은 선택사항).
  unspecified: number
}

// 억제 사유 — 납품물·콘솔이 "왜 수치가 없는지"를 정확히 표기할 수 있게 한다 (억제도 절차 증빙의 일부).
//  contributors   기여자 수가 k 미만 (그룹 자체가 너무 작다)
//  small_cell     비영이면서 k 미만인 셀 존재 (C3 — "추정 1건"이 특정인 확정으로 이어진다)
//  group_residual byGroup 중 억제된 그룹이 있어 overall 도 억제 (C2 — 차분 복원 차단)
//  complementary  억제 그룹이 1개뿐이라 잔차로 복원되므로 추가 억제된 그룹 (C2)
export type EvidenceSuppressionReason = 'contributors' | 'small_cell' | 'group_residual' | 'complementary' | null

export type EvidenceKindDistribution = {
  // 집계 대상 발언 수 (미지정 포함).
  total: number
  // 근거 유형을 실제로 고른 발언 수.
  tagged: number
  // 기여자(서로 다른 작성자) 수 — k-익명 판정 근거.
  contributors: number
  counts: EvidenceKindCounts
  // total 대비 비율. total 0 이거나 억제면 전부 0.
  ratios: EvidenceKindCounts
  // true 면 수치 전부 0 으로 마스킹. 개인 태깅 역추론 차단.
  suppressed: boolean
  suppressionReason: EvidenceSuppressionReason
}

export type EvidenceKindBreakdown = {
  overall: EvidenceKindDistribution
  byGroup: Array<{ groupId: string; distribution: EvidenceKindDistribution }>
}

export type EvidenceKindRoundBreakdown = EvidenceKindBreakdown & { roundId: string | null }

const ZERO_COUNTS: EvidenceKindCounts = { experience: 0, source: 0, estimate: 0, unspecified: 0 }

function emptyDistribution(
  contributors = 0,
  suppressed = false,
  suppressionReason: EvidenceSuppressionReason = null
): EvidenceKindDistribution {
  return { total: 0, tagged: 0, contributors, counts: { ...ZERO_COUNTS }, ratios: { ...ZERO_COUNTS }, suppressed, suppressionReason }
}

// 이미 계산된 분포를 사후 억제한다 (C2 — 그룹 억제 사실이 드러난 뒤 overall/보완 그룹을 지운다).
// 수치는 전부 0 으로 마스킹하고 contributors 만 남긴다(억제 판정 근거 표기용).
function suppressDistribution(d: EvidenceKindDistribution, reason: EvidenceSuppressionReason): EvidenceKindDistribution {
  if (d.suppressed) return d
  return emptyDistribution(d.contributors, true, reason)
}

// 기여자 수 — 식별 가능한 작성자는 각각 1, 작성자 미상(대리입력)은 전부 합쳐 1.
function contributorCount(items: EvidenceKindItem[]): number {
  const known = new Set<string>()
  let hasAnonymous = false
  for (const it of items) {
    if (it.authorParticipantId) known.add(it.authorParticipantId)
    else hasAnonymous = true
  }
  return known.size + (hasAnonymous ? 1 : 0)
}

function distributionFor(items: EvidenceKindItem[], kThreshold: number): EvidenceKindDistribution {
  const contributors = contributorCount(items)
  if (items.length === 0) return emptyDistribution(0, false)
  // k-익명 억제: 기여자가 임계 미만이면 개인의 태깅 성향이 그대로 드러난다 → 수치 미노출.
  if (contributors < kThreshold) return emptyDistribution(contributors, true, 'contributors')
  const counts: EvidenceKindCounts = { ...ZERO_COUNTS }
  for (const it of items) {
    if (it.evidenceKind === 'experience') counts.experience += 1
    else if (it.evidenceKind === 'source') counts.source += 1
    else if (it.evidenceKind === 'estimate') counts.estimate += 1
    else counts.unspecified += 1
  }
  // C3 셀 억제: 기여자 수가 충분해도 **셀** 하나가 작으면 그 셀이 개인을 지목한다
  // (기여자 4명 3:1 → "추정 1건" = 특정인 확정). 부분 마스킹은 total 잔차로 복원되므로
  // 셀 단위가 아니라 **분포 전체**를 억제한다.
  const hasSmallCell = (Object.values(counts) as number[]).some((c) => c > 0 && c < kThreshold)
  if (hasSmallCell) return emptyDistribution(contributors, true, 'small_cell')
  const total = items.length
  const ratios: EvidenceKindCounts = {
    experience: counts.experience / total,
    source: counts.source / total,
    estimate: counts.estimate / total,
    unspecified: counts.unspecified / total
  }
  return {
    total,
    tagged: counts.experience + counts.source + counts.estimate,
    contributors,
    counts,
    ratios,
    suppressed: false,
    suppressionReason: null
  }
}

// 근거 유형 분포 — 전체 + 그룹별. 그룹 미배정(groupId null) 발언은 overall 에만 포함된다.
export function computeEvidenceKindDistribution(
  items: EvidenceKindItem[],
  options: ComputeOptions = {}
): EvidenceKindBreakdown {
  const kThreshold = options.kAnonymityThreshold ?? DEFAULT_K_ANONYMITY
  const byGroupMap = new Map<string, EvidenceKindItem[]>()
  for (const it of items) {
    if (it.groupId == null) continue
    const arr = byGroupMap.get(it.groupId) ?? []
    arr.push(it)
    byGroupMap.set(it.groupId, arr)
  }
  let overall = distributionFor(items, kThreshold)
  const byGroup = [...byGroupMap.entries()]
    .map(([groupId, arr]) => ({ groupId, distribution: distributionFor(arr, kThreshold) }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId))

  // ── C2 차분(differencing) 공격 차단 ──
  // overall 과 byGroup 이 같은 페이로드에 실리므로, 억제된 그룹의 수치는
  // overall − Σ(공개 그룹) 으로 오차 0 복원된다. 억제가 하나라도 있으면 overall 을 함께 억제한다.
  // (그룹 미배정 발언이 overall 에만 포함되어 잔차가 정확히 일치하지 않는 경우가 있지만,
  //  일치 여부를 공격자가 알 수 없다고 가정하는 것은 방어가 아니므로 무조건 억제한다.)
  const suppressedGroups = byGroup.filter((g) => g.distribution.suppressed)
  if (suppressedGroups.length > 0) {
    overall = suppressDistribution(overall, 'group_residual')
    // 억제 그룹이 정확히 1개면 "나머지 전부 공개 + 억제 1개" 구조라 다른 집계(라운드 합 등)와
    // 대조하면 즉시 복원된다 → 가장 작은 공개 그룹을 하나 더 억제한다 (complementary suppression).
    if (suppressedGroups.length === 1) {
      const published = byGroup.filter((g) => !g.distribution.suppressed)
      if (published.length > 0) {
        // 결정론적 선택: total 최소 → 동률이면 groupId 사전순.
        const victim = published.slice().sort(
          (a, b) => a.distribution.total - b.distribution.total || a.groupId.localeCompare(b.groupId)
        )[0]
        victim.distribution = suppressDistribution(victim.distribution, 'complementary')
      }
    }
  }

  return { overall, byGroup }
}

// 라운드별 근거 유형 분포. roundId 미지정 발언은 별도 버킷(null)으로 묶는다.
export function computeEvidenceKindByRound(
  items: EvidenceKindItem[],
  options: ComputeOptions = {}
): EvidenceKindRoundBreakdown[] {
  const byRound = new Map<string, EvidenceKindItem[]>()
  // roundId 가 null 인 항목의 Map 키 sentinel. 실제 roundId(uuid/문자열)와 절대 충돌하지 않는 값.
  const NULL_KEY = '__no_round__'
  for (const it of items) {
    const key = it.roundId ?? NULL_KEY
    const arr = byRound.get(key) ?? []
    arr.push(it)
    byRound.set(key, arr)
  }
  return [...byRound.entries()].map(([key, arr]) => ({
    roundId: key === NULL_KEY ? null : key,
    ...computeEvidenceKindDistribution(arr, options)
  }))
}

// ============================================================
// Q4 — 앱 제출 분포 (DELIBERATION-QUALITY-PLAN §2 Q4 / §5 지표)
// "발언 균등도"가 아니다. 오프라인 구두 발언은 측정하지 않고, 앱/대리 입력으로 저장된
// 텍스트 제출만 센다. 개인 단위는 표시하지 않는다.
// ============================================================

export type AppSubmissionItem = {
  statementId: string
  roundId?: string | null
  groupId?: string | null
  authorParticipantId?: string | null
}

export type AppSubmissionGroupInput = {
  groupId: string
  memberCount: number
}

export type AppSubmissionSuppressionReason = 'proxy_entry' | 'members' | 'submitters' | null

export type AppSubmissionGroupDistribution = {
  groupId: string
  memberCount: number
  statementCount: number
  submittedParticipants: number
  submissionRatio: number
  suppressed: boolean
  suppressionReason: AppSubmissionSuppressionReason
}

export type AppSubmissionRoundDistribution = {
  roundId: string | null
  suppressed: boolean
  suppressionReason: AppSubmissionSuppressionReason
  groups: AppSubmissionGroupDistribution[]
}

function emptySubmissionGroup(
  groupId: string,
  memberCount: number,
  suppressed = false,
  suppressionReason: AppSubmissionSuppressionReason = null
): AppSubmissionGroupDistribution {
  return { groupId, memberCount, statementCount: 0, submittedParticipants: 0, submissionRatio: 0, suppressed, suppressionReason }
}

function suppressSubmissionGroup(g: AppSubmissionGroupDistribution, reason: AppSubmissionSuppressionReason): AppSubmissionGroupDistribution {
  return emptySubmissionGroup(g.groupId, g.memberCount, true, reason)
}

export function computeAppSubmissionDistributionByRound(
  items: AppSubmissionItem[],
  groups: AppSubmissionGroupInput[],
  options: ComputeOptions = {}
): AppSubmissionRoundDistribution[] {
  const kThreshold = options.kAnonymityThreshold ?? DEFAULT_K_ANONYMITY
  const groupInputs = groups.slice().sort((a, b) => a.groupId.localeCompare(b.groupId))
  const byRound = new Map<string, AppSubmissionItem[]>()
  const NULL_KEY = '__no_round__'
  for (const it of items) {
    const key = it.roundId ?? NULL_KEY
    const arr = byRound.get(key) ?? []
    arr.push(it)
    byRound.set(key, arr)
  }

  return [...byRound.entries()].map(([key, roundItems]) => {
    const hasUnknownAuthor = roundItems.some((it) => it.authorParticipantId == null)
    const roundId = key === NULL_KEY ? null : key
    if (hasUnknownAuthor) {
      return {
        roundId,
        suppressed: true,
        suppressionReason: 'proxy_entry',
        groups: groupInputs.map((g) => emptySubmissionGroup(g.groupId, g.memberCount, true, 'proxy_entry'))
      }
    }

    const groupsOut = groupInputs.map((g) => {
      const groupItems = roundItems.filter((it) => it.groupId === g.groupId)
      const submitters = new Set(groupItems.map((it) => it.authorParticipantId).filter((id): id is string => Boolean(id)))
      const visible: AppSubmissionGroupDistribution = {
        groupId: g.groupId,
        memberCount: g.memberCount,
        statementCount: groupItems.length,
        submittedParticipants: submitters.size,
        submissionRatio: g.memberCount > 0 ? submitters.size / g.memberCount : 0,
        suppressed: false,
        suppressionReason: null
      }
      if (g.memberCount > 0 && g.memberCount < kThreshold) return suppressSubmissionGroup(visible, 'members')
      if (submitters.size > 0 && submitters.size < kThreshold) return suppressSubmissionGroup(visible, 'submitters')
      return visible
    })

    return { roundId, suppressed: false, suppressionReason: null, groups: groupsOut }
  })
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
