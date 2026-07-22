// Lecture LiveOps — 의견 지형(opinion landscape) 지표 (Post-MVP B / 통계 하드닝 2026-07-22)
// clustering.ts 의 커널(투표행렬 → 결측 평균대체 → PCA → K-means)을 제품 규칙으로 감싼다.
//
// ★ 설계 대전제 ★
//   이 모듈은 "그럴듯한 그림"보다 "정직한 침묵"을 택한다. 이중 검증(Codex 코드 + 수치 시뮬레이션)에서
//   완전 무작위 투표(n=60, 발언 15)의 89.7% 가 실루엣 0.3 을 넘었고(무구조가 공식 그룹이 됨),
//   그룹 간 차이가 전무한 귀무가설에서도 대표의견이 100% 확률로 뽑혔다.
//   → 아래 게이트들을 통과하지 못하면 지형은 비활성되고, UI/리포트는
//     "의견 그룹을 통계적으로 확인할 수 없음"을 명시한다. 대부분의 실제 세션에서 그럴 것이고 그게 의도다.
//
// 제품 규칙:
//  - 소규모 게이트: 유효 참가자 60명 미만이면 비활성 (클러스터당 20~30 관측치 문헌 기준).
//    n≥60 → k∈{2,3}, n≥100 → k∈{2..5}. 어떤 경우든 클러스터당 20명 미만이 되는 k 는 배제 (C6).
//  - 참가자 최소 투표 임계 7표 (Polis 기준) — 그 미만은 클러스터링에서 제외.
//  - MNAR 게이트(C5): 결측률 40% 초과 발언은 클러스터링 입력에서 제외한다. 삭제가 아니라
//    "응답 회피가 높은 발언"으로 리포트에 별도 표기한다 — 회피 자체가 정보다.
//  - 순열검정 게이트(C2): 열별 독립 셔플로 만든 null 실루엣 분포의 95th 백분위를 넘어야만 활성.
//  - 설명분산(C3): (λ1+λ2)/Σλ 를 노출. 50% 미만이면 경고, 35% 미만이면 프로젝터 산점도 자체를 숨긴다.
//  - 대표의견(C4): 원시 카운트 two-proportion z-test(소표본은 Fisher) + BH FDR 보정.
//    p_adj<0.05 AND lift≥0.2 를 동시에 만족해야 채택.
//  - GIC(Group-Informed Consensus, H4): 그룹별 라플라스 스무딩 찬성확률의 **기하평균** (Πp)^(1/k).
//    곱셈은 k 가 커질수록 값이 작아져 세션 간 비교가 불가능했다.
//  - k-익명(H3): GIC 는 클러스터별 최소 유효표, 대표의견은 inside.votes ≥ max(10, ceil(size*0.3)).
//  - 안정성(H5): leave-one-out 라벨 일치율 90% 미만이면 unstable 경고.
//  - 프라이버시(H2): projection 좌표는 스냅샷 내부 기록용이며 공개 API allowlist 에서 제외한다.
//
// 결정론: clustering.ts 가 결정론적이고(순열 셔플도 고정 시드), 여기서도 Map 순회 대신 정렬된 배열만 쓴다.
// 같은 입력이면 항상 같은 landscape 가 나온다 (증빙 제품 요구사항).

import {
  buildVoteMatrix,
  createRng,
  filterByMinVotes,
  imputeMeans,
  kmeans,
  pca2d,
  permuteColumns,
  silhouetteScore,
  type Point2D,
  type VoteMatrix,
  type VoteRecord
} from './clustering'
import { benjaminiHochberg, percentile, proportionDiffTest, wilsonInterval } from './stats'
import type { SnapshotPayload } from './metrics'

export type { VoteRecord } from './clustering'

// 비활성 사유 코드 — UI/리포트가 사람 말로 바꿔 쓴다.
export type LandscapeDisabledReason =
  | 'participants_below_minimum' // 유효 참가자 60명 미만
  | 'insufficient_statements' // 분석 가능한 발언 2건 미만 (PCA 불가 / MNAR 제외 후 포함)
  | 'no_valid_k' // 클러스터당 최소 인원(20명)을 만족하는 k 가 없음
  | 'vote_matrix_unavailable' // 개인 표 행렬을 읽을 수 없음 (권한/저장소 제약)
  | 'low_separation' // 순열검정 미통과 — 무작위 데이터와 구분되지 않음 (C2)
  | 'pca_not_converged' // 주성분 계산 미수렴 — 좌표를 신뢰할 수 없음 (H1)

export type LandscapeCluster = {
  id: number
  size: number
  centroid: Point2D
}

// 익명 좌표 — participantId 없음 (의도적). H2: 공개 payload 에는 싣지 않는다.
export type LandscapePoint = { x: number; y: number; cluster: number }

// GIC 항목 — 그룹별 찬성확률의 기하평균 + 그룹별 표본/Wilson CI 병기 (H4).
export type GicClusterStat = {
  clusterId: number
  votes: number
  agree: number
  agreeRate: number
  ciLow: number
  ciHigh: number
}

export type GicItem = {
  statementId: string
  // (Πp)^(1/k), p 는 라플라스 스무딩 찬성확률. k 와 무관하게 0~1 스케일이 유지된다.
  score: number
  perCluster: GicClusterStat[]
}

export type LiftBucket = 'strong' | 'moderate' | 'slight'

export type RepresentativeItem = {
  clusterId: number
  statementId: string
  // lift = (그룹 내 찬성률) - (그룹 밖 찬성률). 원시(스무딩 전) 비율 차이.
  lift: number
  agreeRate: number
  insideVotes: number
  insideAgree: number
  outsideVotes: number
  outsideAgree: number
  // 무보정 p / BH 보정 p. 채택 조건은 pAdjusted < 0.05 AND lift >= 0.2.
  pValue: number
  pAdjusted: number
  test: 'z' | 'fisher'
  // 클러스터 내 순위(1부터) + 효과크기 bucket — 공개 UI 는 정확 수치 대신 이것만 쓴다 (H3).
  rank: number
  bucket: LiftBucket
}

// 발언별 결측률 (C5). excluded=true 면 클러스터링 입력에서 빠진 "응답 회피가 높은 발언".
export type StatementMissingness = {
  statementId: string
  missingRate: number
  votes: number
  excluded: boolean
}

// 순열검정 결과 (C2).
export type PermutationTest = {
  iterations: number
  observed: number
  threshold95: number
  pValue: number
  passed: boolean
}

// leave-one-out 안정성 (H5).
export type StabilityCheck = {
  samples: number
  agreement: number
  unstable: boolean
}

export type LandscapeResult = {
  enabled: boolean
  reason?: LandscapeDisabledReason
  // 전체 참가자 수 / 최소 투표 임계를 넘긴 유효 참가자 수.
  participantCount: number
  eligibleCount: number
  k: number
  silhouette: number
  // (λ1+λ2)/Σλ — 2D 좌표가 설명하는 분산 비율 (C3).
  explainedVarianceRatio: number
  // 설명분산 50% 미만 → 경고 배지 (프로젝터·리포트 양쪽).
  lowExplainedVariance: boolean
  // 설명분산 35% 미만 → 프로젝터에서 산점도 자체를 노출하지 않는다 (표/랭킹만).
  suppressProjection: boolean
  permutation: PermutationTest | null
  stability: StabilityCheck | null
  // MNAR 진단 — 전체 발언(제외된 것 포함). statementId 오름차순.
  missingness: StatementMissingness[]
  // 실제 클러스터링에 들어간 발언 수 (MNAR 제외 후).
  analyzedStatementCount: number
  clusters: LandscapeCluster[]
  projection: LandscapePoint[]
  gic: GicItem[]
  representatives: RepresentativeItem[]
}

// 스냅샷 payload — 기존 SnapshotPayload 에 landscape 필드가 덧붙은 형태.
// 구 스냅샷에는 landscape 가 없으므로 optional (마이그레이션 없이 하위호환).
export type SnapshotPayloadWithLandscape = SnapshotPayload & { landscape?: LandscapeResult }

export type LandscapeOptions = {
  minVotesPerParticipant?: number
  minParticipants?: number
  largeSessionThreshold?: number
  minClusterSize?: number
  maxK?: number
  kAnonymityThreshold?: number
  topGic?: number
  topRepresentativesPerCluster?: number
  // C5: 이 결측률을 초과하는 발언은 클러스터링 입력에서 제외.
  maxMissingRate?: number
  // C2: 순열검정 반복 수(상한). 비용 예산에 따라 자동으로 줄어들 수 있다.
  permutationIterations?: number
  // 순열검정 비용 상한(대략 n·d² 연산 기준). 초과하면 반복 수를 줄인다.
  permutationOpsBudget?: number
  // C3 경고/차단 임계.
  lowVarianceWarnThreshold?: number
  varianceSuppressThreshold?: number
  // C4 채택 조건.
  representativeAlpha?: number
  representativeMinLift?: number
  // H3: 대표의견 노출 최소 유효표 = max(절대값, ceil(clusterSize × 비율)).
  representativeMinVotesAbsolute?: number
  representativeMinVotesFraction?: number
  // H3: GIC 클러스터별 최소 유효표 = max(절대값, ceil(clusterSize × 비율)).
  gicMinClusterVotesAbsolute?: number
  gicMinClusterVotesFraction?: number
  // H5: leave-one-out 표본 수(상한)와 unstable 판정 임계.
  stabilitySamples?: number
  stabilityThreshold?: number
}

const DEFAULTS = {
  minVotesPerParticipant: 7,
  minParticipants: 60,
  largeSessionThreshold: 100,
  minClusterSize: 20,
  maxK: 5,
  kAnonymityThreshold: 3,
  topGic: 10,
  topRepresentativesPerCluster: 3,
  maxMissingRate: 0.4,
  permutationIterations: 200,
  permutationOpsBudget: 4e8,
  lowVarianceWarnThreshold: 0.5,
  varianceSuppressThreshold: 0.35,
  representativeAlpha: 0.05,
  representativeMinLift: 0.2,
  representativeMinVotesAbsolute: 10,
  representativeMinVotesFraction: 0.3,
  gicMinClusterVotesAbsolute: 5,
  gicMinClusterVotesFraction: 0.2,
  stabilitySamples: 20,
  stabilityThreshold: 0.9
}

// 순열검정/안정성 검사가 쓰는 고정 시드 — 결정론 유지.
const PERMUTATION_SEED = 0x5eed7a11
// null 표본용 power iteration 상한. 정밀도보다 반복 수가 중요하고, 미수렴이어도
// null 실루엣을 과대평가하지 않는다(수렴 부족 = 축이 덜 뾰족 = 분리도 낮음 → 게이트가 느슨해질 위험).
// 그래서 상한을 지나치게 낮추지 않고 120 으로 둔다.
const PERMUTATION_POWER_ITER = 120

type LandscapeExtras = Partial<
  Pick<
    LandscapeResult,
    'explainedVarianceRatio' | 'lowExplainedVariance' | 'suppressProjection' | 'permutation' | 'missingness' | 'analyzedStatementCount' | 'k' | 'silhouette'
  >
>

function disabled(
  reason: LandscapeDisabledReason,
  participantCount: number,
  eligibleCount: number,
  extras: LandscapeExtras = {}
): LandscapeResult {
  return {
    enabled: false,
    reason,
    participantCount,
    eligibleCount,
    k: 0,
    silhouette: 0,
    explainedVarianceRatio: 0,
    lowExplainedVariance: true,
    suppressProjection: true,
    permutation: null,
    stability: null,
    missingness: [],
    analyzedStatementCount: 0,
    clusters: [],
    projection: [],
    gic: [],
    representatives: [],
    ...extras
  }
}

// 클러스터 g 의 statement j 에 대한 (찬성수, 투표수). 결측(미투표)은 세지 않는다.
function clusterTally(matrix: VoteMatrix, memberRows: number[], j: number): { agree: number; votes: number } {
  let agree = 0
  let votes = 0
  for (const i of memberRows) {
    const v = matrix.values[i][j]
    if (v == null) continue
    votes += 1
    if (v > 0) agree += 1
  }
  return { agree, votes }
}

// 라플라스 스무딩 찬성확률 (agree+1)/(votes+2). GIC 전용 — 검정에는 원시 카운트를 쓴다.
function smoothedAgreeProb(agree: number, votes: number): number {
  return (agree + 1) / (votes + 2)
}

// 지정한 열(statement)만 남긴 부분 행렬.
function selectStatements(matrix: VoteMatrix, keepCols: number[]): VoteMatrix {
  return {
    participantIds: matrix.participantIds,
    statementIds: keepCols.map((j) => matrix.statementIds[j]),
    values: matrix.values.map((row) => keepCols.map((j) => row[j]))
  }
}

// 발언별 결측률 (C5) — 유효 참가자 기준.
function computeMissingness(matrix: VoteMatrix, maxMissingRate: number): StatementMissingness[] {
  const n = matrix.values.length
  return matrix.statementIds.map((statementId, j) => {
    let votes = 0
    for (let i = 0; i < n; i += 1) if (matrix.values[i][j] != null) votes += 1
    const missingRate = n > 0 ? (n - votes) / n : 1
    return { statementId, missingRate, votes, excluded: missingRate > maxMissingRate }
  })
}

// k 개 라벨의 최적 대응(브루트포스 순열)으로 두 라벨링의 일치율을 계산한다. k ≤ 5 이므로 최대 120 조합.
function labelAgreement(a: number[], b: number[], k: number): number {
  const n = a.length
  if (n === 0) return 1
  const idx = Array.from({ length: k }, (_, i) => i)
  const perms: number[][] = []
  const build = (cur: number[], rest: number[]) => {
    if (rest.length === 0) {
      perms.push(cur)
      return
    }
    for (let i = 0; i < rest.length; i += 1) {
      build([...cur, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)])
    }
  }
  build([], idx)
  let best = 0
  for (const perm of perms) {
    let match = 0
    for (let i = 0; i < n; i += 1) if (perm[a[i]] === b[i]) match += 1
    if (match > best) best = match
  }
  return best / n
}

// H5: leave-one-out 안정성. 참가자 1명을 빼고 전체 파이프라인을 다시 돌려 라벨 일치율을 본다.
// 비용 때문에 결정론적으로 균등 간격 표본만 검사한다 (무작위 선택 아님 — 재현 가능해야 함).
function leaveOneOutStability(
  imputed: number[][],
  baselineLabels: number[],
  k: number,
  samples: number,
  threshold: number
): StabilityCheck | null {
  const n = imputed.length
  if (n < 3 || samples <= 0) return null
  const count = Math.min(samples, n)
  const picks: number[] = []
  for (let s = 0; s < count; s += 1) {
    const idx = Math.floor((s * n) / count)
    if (!picks.includes(idx)) picks.push(idx)
  }
  let sum = 0
  for (const drop of picks) {
    const rows: number[][] = []
    const base: number[] = []
    for (let i = 0; i < n; i += 1) {
      if (i === drop) continue
      rows.push(imputed[i])
      base.push(baselineLabels[i])
    }
    const pj = pca2d(rows, { maxIter: PERMUTATION_POWER_ITER })
    const km = kmeans(pj.points, k)
    sum += labelAgreement(base, km.labels, k)
  }
  const agreement = sum / picks.length
  return { samples: picks.length, agreement, unstable: agreement < threshold }
}

// 하나의 좌표집합에서 "k 선택 규칙을 적용한 최선 실루엣"을 구한다.
// 관측치와 null 표본이 **같은 선택 절차**를 거치게 하려고 함수로 분리했다.
function bestSilhouetteOver(points: Point2D[], candidateKs: number[], minClusterSize: number): number {
  let best = -1
  for (const k of candidateKs) {
    const km = kmeans(points, k)
    if (km.emptyClusterCount > 0) continue
    const sizes = new Array<number>(k).fill(0)
    for (const l of km.labels) sizes[l] += 1
    if (sizes.some((s) => s < minClusterSize)) continue
    const score = silhouetteScore(points, km.labels, k)
    if (score > best) best = score
  }
  return best
}

// C2: 순열검정. 열(statement)별로 참가자 순서를 독립 셔플해 한계분포(발언별 찬반 비율)는 보존하고
// 참가자 간 상관(=그룹 구조)만 파괴한 null 데이터를 만든 뒤 실루엣 분포를 얻는다.
// 관측 실루엣이 null 분포의 95th 백분위를 넘을 때만 지형을 활성화한다.
//
// 리뷰 지침은 "같은 k 로" 였지만, 관측치는 후보 k 들 중 **최대** 실루엣이므로 null 도 같은
// 최대화 절차를 거쳐야 공정하다. 고정 k null 은 선택편향만큼 게이트를 느슨하게 만든다
// (실측: n=80 무작위에서 고정 k null 이 관측치를 통과시키는 사례 발생). → 후보 전체 최대값을 쓴다.
function permutationTest(
  imputed: number[][],
  candidateKs: number[],
  minClusterSize: number,
  observed: number,
  iterations: number,
  opsBudget: number
): PermutationTest {
  const n = imputed.length
  const d = n > 0 ? imputed[0].length : 0
  // 비용 상한 — 공분산 계산이 O(n·d²) 라 대형 세션에서 반복 수를 줄인다.
  // (근사가 아니라 정확한 순열검정이며 표본 수만 줄어든다. 최소 40회는 보장.)
  const perRun = Math.max(1, n * d * d)
  const budgeted = Math.floor(opsBudget / perRun)
  const b = Math.max(40, Math.min(iterations, Number.isFinite(budgeted) ? budgeted : iterations))
  const rng = createRng(PERMUTATION_SEED)
  const nulls: number[] = []
  for (let t = 0; t < b; t += 1) {
    const shuffled = permuteColumns(imputed, rng)
    const pj = pca2d(shuffled, { maxIter: PERMUTATION_POWER_ITER })
    nulls.push(bestSilhouetteOver(pj.points, candidateKs, minClusterSize))
  }
  nulls.sort((x, y) => x - y)
  const threshold95 = percentile(nulls, 0.95)
  let atLeast = 0
  for (const v of nulls) if (v >= observed) atLeast += 1
  const pValue = (1 + atLeast) / (b + 1)
  return { iterations: b, observed, threshold95, pValue, passed: observed > threshold95 }
}

function bucketOf(lift: number): LiftBucket {
  if (lift >= 0.4) return 'strong'
  if (lift >= 0.3) return 'moderate'
  return 'slight'
}

// 의견 지형 계산. votes 는 개인 표 원자료지만 결과에는 절대 실리지 않는다 (거버넌스 §7-2).
export function computeLandscape(
  input: { votes: VoteRecord[]; statementIds: string[]; participantIds: string[] },
  options: LandscapeOptions = {}
): LandscapeResult {
  const opt = { ...DEFAULTS, ...options }

  const matrix = buildVoteMatrix(input.votes, input.statementIds, input.participantIds)
  const participantCount = matrix.participantIds.length
  // 최소 투표 임계 미만 참가자 제외 (Polis 기준 7표).
  const eligible = filterByMinVotes(matrix, opt.minVotesPerParticipant)
  const eligibleCount = eligible.participantIds.length

  if (eligibleCount < opt.minParticipants) {
    return disabled('participants_below_minimum', participantCount, eligibleCount)
  }

  // ── C5(MNAR): 결측률이 높은 발언은 평균대체 편향이 크므로 클러스터링 입력에서 제외한다.
  //    (시뮬레이션 실측: 반대자 기권율 60% vs 찬성자 10% 이면 statement 평균대체가 +0.397 편향.)
  //    제외한 발언은 삭제하지 않고 missingness 로 남겨 리포트가 "응답 회피가 높은 발언"으로 표기한다.
  const missingness = computeMissingness(eligible, opt.maxMissingRate)
  const keepCols: number[] = []
  for (let j = 0; j < missingness.length; j += 1) if (!missingness[j].excluded) keepCols.push(j)
  const analysis = selectStatements(eligible, keepCols)
  const analyzedStatementCount = analysis.statementIds.length

  if (analyzedStatementCount < 2) {
    return disabled('insufficient_statements', participantCount, eligibleCount, { missingness, analyzedStatementCount })
  }

  const imputed = imputeMeans(analysis)
  const projected = pca2d(imputed)

  // H1: 주성분이 수렴하지 않으면 좌표 자체를 신뢰할 수 없다 → 지형 비활성.
  if (!projected.converged) {
    return disabled('pca_not_converged', participantCount, eligibleCount, { missingness, analyzedStatementCount })
  }

  const explainedVarianceRatio = projected.explainedVarianceRatio
  const lowExplainedVariance = explainedVarianceRatio < opt.lowVarianceWarnThreshold
  const suppressProjection = explainedVarianceRatio < opt.varianceSuppressThreshold

  // ── C6: k 후보. n≥60 → {2,3}, n≥largeSessionThreshold(100) → {2..maxK}.
  //    "클러스터당 20~30" 문헌은 최소 크기 근거이지 k 상한 근거가 아니다.
  const topK = eligibleCount < opt.largeSessionThreshold ? Math.min(3, opt.maxK) : opt.maxK
  const candidateKs = Array.from({ length: Math.max(0, topK - 1) }, (_, i) => i + 2).filter(
    (k) => Math.floor(eligibleCount / k) >= opt.minClusterSize
  )

  let best: { k: number; labels: number[]; centroids: Point2D[]; score: number } | null = null
  for (const k of candidateKs) {
    const km = kmeans(projected.points, k)
    // M2: 빈 클러스터가 생긴 k 는 데이터에 맞지 않는다 → 후보 배제.
    if (km.emptyClusterCount > 0) continue
    const sizes = new Array<number>(k).fill(0)
    for (const l of km.labels) sizes[l] += 1
    // 실제 결과에서도 클러스터당 20명 미만이면 배제 (사전 배제는 필요조건일 뿐).
    if (sizes.some((s) => s < opt.minClusterSize)) continue
    const score = silhouetteScore(projected.points, km.labels, k)
    // 동점이면 더 작은 k (후보가 오름차순이므로 strict > 비교로 자동 처리).
    if (best == null || score > best.score) {
      best = { k, labels: km.labels, centroids: km.centroids, score }
    }
  }
  if (best == null) {
    return disabled('no_valid_k', participantCount, eligibleCount, {
      explainedVarianceRatio,
      lowExplainedVariance,
      suppressProjection,
      missingness,
      analyzedStatementCount
    })
  }
  const chosen = best

  // ── C2: 순열검정. 절대 실루엣 임계(0.3 등)는 허구였다 — 무구조 데이터의 89.7% 가 넘겼다.
  const permutation = permutationTest(
    imputed,
    candidateKs,
    opt.minClusterSize,
    chosen.score,
    opt.permutationIterations,
    opt.permutationOpsBudget
  )
  if (!permutation.passed) {
    return disabled('low_separation', participantCount, eligibleCount, {
      k: chosen.k,
      silhouette: chosen.score,
      explainedVarianceRatio,
      lowExplainedVariance,
      suppressProjection,
      permutation,
      missingness,
      analyzedStatementCount
    })
  }

  // ── H5: leave-one-out 안정성 (경고만 — 비활성 사유는 아니다).
  const stability = leaveOneOutStability(imputed, chosen.labels, chosen.k, opt.stabilitySamples, opt.stabilityThreshold)

  // 클러스터별 멤버 행 인덱스 (내부 계산 전용 — 출력에 싣지 않는다).
  const memberRows: number[][] = Array.from({ length: chosen.k }, () => [])
  for (let i = 0; i < chosen.labels.length; i += 1) memberRows[chosen.labels[i]].push(i)

  const clusters: LandscapeCluster[] = memberRows.map((rows, id) => ({
    id,
    size: rows.length,
    centroid: chosen.centroids[id] ?? { x: 0, y: 0 }
  }))

  // 익명 좌표 — participantId 미포함 + (cluster, x, y) 정렬로 인덱스 역추적 차단.
  // H2: 이 배열은 스냅샷 내부 기록용이며 공개 API/프로젝터 payload 에는 실리지 않는다.
  const projection: LandscapePoint[] = projected.points
    .map((p, i) => ({ x: p.x, y: p.y, cluster: chosen.labels[i] }))
    .sort((a, b) => a.cluster - b.cluster || a.x - b.x || a.y - b.y)

  // ── GIC(H4): 그룹별 라플라스 스무딩 찬성확률의 기하평균. 곱셈은 k 가 커질수록 값이 작아져
  //    세션 간/설정 간 비교가 불가능했다(전 그룹 90% 찬성: k=2 0.746 → k=8 0.310).
  //    H3: 클러스터별 최소 유효표를 요구해 "그룹 표본 0~1" 짜리 발언이 상위에 오르는 것을 막는다.
  const gic: GicItem[] = []
  for (let j = 0; j < analysis.statementIds.length; j += 1) {
    const perCluster = memberRows.map((rows, id) => ({ id, size: rows.length, ...clusterTally(analysis, rows, j) }))
    const totalVotes = perCluster.reduce((a, t) => a + t.votes, 0)
    if (totalVotes < opt.kAnonymityThreshold) continue
    const enough = perCluster.every(
      (t) => t.votes >= Math.max(opt.gicMinClusterVotesAbsolute, Math.ceil(t.size * opt.gicMinClusterVotesFraction))
    )
    if (!enough) continue
    let logSum = 0
    for (const t of perCluster) logSum += Math.log(smoothedAgreeProb(t.agree, t.votes))
    gic.push({
      statementId: analysis.statementIds[j],
      score: Math.exp(logSum / chosen.k),
      perCluster: perCluster.map((t) => {
        const ci = wilsonInterval(t.agree, t.votes)
        return {
          clusterId: t.id,
          votes: t.votes,
          agree: t.agree,
          agreeRate: t.votes > 0 ? t.agree / t.votes : 0,
          ciLow: ci.low,
          ciHigh: ci.high
        }
      })
    })
  }
  gic.sort((a, b) => b.score - a.score || (a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0))

  // ── C4: 그룹별 대표 의견. 원시 카운트로 검정하고 세션 단위 BH FDR 보정을 건다.
  //    무보정으로는 귀무가설에서도 76.5%, lift>0 규칙만으로는 100% 가 뽑혔다.
  type Candidate = RepresentativeItem & { pRaw: number }
  const candidates: Candidate[] = []
  for (let g = 0; g < chosen.k; g += 1) {
    const size = memberRows[g].length
    // 클러스터 size<20 이면 대표의견 억제 (개인 식별 위험).
    if (size < opt.minClusterSize) continue
    const outsideRows: number[] = []
    for (let h = 0; h < chosen.k; h += 1) if (h !== g) outsideRows.push(...memberRows[h])
    outsideRows.sort((a, b) => a - b)
    // H3: 그룹 규모 대비 충분한 표가 있어야 "이 그룹은 이렇게 생각한다"를 말할 수 있다.
    const minInside = Math.max(opt.representativeMinVotesAbsolute, Math.ceil(size * opt.representativeMinVotesFraction))

    for (let j = 0; j < analysis.statementIds.length; j += 1) {
      const inside = clusterTally(analysis, memberRows[g], j)
      const outside = clusterTally(analysis, outsideRows, j)
      if (inside.votes < minInside) continue
      if (outside.votes < opt.kAnonymityThreshold) continue
      const pIn = inside.agree / inside.votes
      const pOut = outside.agree / outside.votes
      const lift = pIn - pOut
      if (lift <= 0) continue
      const test = proportionDiffTest(inside.agree, inside.votes, outside.agree, outside.votes)
      candidates.push({
        clusterId: g,
        statementId: analysis.statementIds[j],
        lift,
        agreeRate: pIn,
        insideVotes: inside.votes,
        insideAgree: inside.agree,
        outsideVotes: outside.votes,
        outsideAgree: outside.agree,
        pValue: test.pValue,
        pAdjusted: 1,
        test: test.method,
        rank: 0,
        bucket: bucketOf(lift),
        pRaw: test.pValue
      })
    }
  }
  // BH 보정은 세션 전체(클러스터 × 발언)를 한 가족으로 본다.
  const adjusted = benjaminiHochberg(candidates.map((c) => c.pRaw))
  const accepted = candidates
    .map((c, i) => ({ ...c, pAdjusted: adjusted[i] }))
    .filter((c) => c.pAdjusted < opt.representativeAlpha && c.lift >= opt.representativeMinLift)

  const representatives: RepresentativeItem[] = []
  for (let g = 0; g < chosen.k; g += 1) {
    const items = accepted
      .filter((c) => c.clusterId === g)
      .sort((a, b) => b.lift - a.lift || a.pAdjusted - b.pAdjusted || (a.statementId < b.statementId ? -1 : 1))
      .slice(0, opt.topRepresentativesPerCluster)
    items.forEach((c, i) => {
      const { pRaw: _pRaw, ...item } = c
      representatives.push({ ...item, rank: i + 1 })
    })
  }

  return {
    enabled: true,
    participantCount,
    eligibleCount,
    k: chosen.k,
    silhouette: chosen.score,
    explainedVarianceRatio,
    lowExplainedVariance,
    suppressProjection,
    permutation,
    stability,
    missingness,
    analyzedStatementCount,
    clusters,
    projection,
    gic: gic.slice(0, opt.topGic),
    representatives
  }
}

// 비활성 사유 → 사람이 읽는 문구 (UI/리포트 공용).
export function landscapeReasonText(result: Pick<LandscapeResult, 'reason' | 'participantCount' | 'eligibleCount'>): string {
  switch (result.reason) {
    case 'participants_below_minimum':
      return `참가자 ${result.participantCount}명 — 의견 지형은 60명 이상에서 표시됩니다`
    case 'insufficient_statements':
      return '분석 가능한 발언이 2건 미만이라 의견 지형을 계산할 수 없습니다'
    case 'no_valid_k':
      return '클러스터당 최소 인원(20명)을 만족하는 그룹 구분을 찾지 못했습니다'
    case 'vote_matrix_unavailable':
      return '개인 표 행렬 접근 권한이 없어 의견 지형을 계산하지 않았습니다'
    case 'low_separation':
      return '의견 그룹을 통계적으로 확인할 수 없습니다 — 관측된 그룹 분리도가 무작위 투표와 구분되지 않습니다(순열검정 미통과)'
    case 'pca_not_converged':
      return '주성분 계산이 수렴하지 않아 의견 지형 좌표를 신뢰할 수 없습니다'
    default:
      return '의견 지형이 계산되지 않았습니다'
  }
}

// 설명분산 경고 문구 (C3) — 활성 상태에서도 표시한다.
export function explainedVarianceWarning(result: Pick<LandscapeResult, 'enabled' | 'explainedVarianceRatio' | 'lowExplainedVariance' | 'suppressProjection'>): string | null {
  if (!result.enabled || !result.lowExplainedVariance) return null
  const pct = Math.round(result.explainedVarianceRatio * 100)
  if (result.suppressProjection) {
    return `2차원 좌표가 전체 의견 차이의 ${pct}% 만 설명합니다 — 산점도는 오해를 부를 수 있어 표시하지 않습니다`
  }
  return `주의: 2차원 좌표가 전체 의견 차이의 ${pct}% 만 설명합니다 — 그림상의 거리는 실제 의견 차이와 다를 수 있습니다`
}

// 안정성 경고 문구 (H5).
export function stabilityWarning(result: Pick<LandscapeResult, 'enabled' | 'stability'>): string | null {
  if (!result.enabled || !result.stability || !result.stability.unstable) return null
  return `주의: 소수 응답자에 민감한 결과입니다 — 참가자 1명을 제외하면 그룹 소속의 ${Math.round((1 - result.stability.agreement) * 100)}% 가 바뀝니다`
}

// 접근 불가(권한/저장소 제약) 상태를 명시적으로 만든다 — 빈 행렬로 조용히 계산하지 않기 위해.
export function landscapeUnavailable(participantCount: number): LandscapeResult {
  return disabled('vote_matrix_unavailable', participantCount, 0)
}
