// Lecture LiveOps — 의견 지형(opinion landscape) 지표 (Post-MVP B)
// clustering.ts 의 커널(투표행렬 → 결측 평균대체 → PCA → K-means)을 제품 규칙으로 감싼다.
//
// 제품 규칙:
//  - 소규모 게이트: 유효 참가자 60명 미만이면 클러스터링 비활성 (문헌 기준 클러스터당 20~30 관측치 필요).
//    60~99명은 k=2 고정, 100명+ 는 k=2~5 를 실루엣으로 선택. 어떤 경우든 클러스터당 20명 미만이 되는 k 는 배제.
//  - 참가자 최소 투표 임계 7표 (Polis 기준) — 그 미만은 클러스터링에서 제외.
//  - 프라이버시: projection 좌표에 participantId 를 넣지 않는다 (개인 위치 추적 방지).
//    좌표는 (클러스터, x, y) 정렬 순으로 재배열해 배열 인덱스로도 참가자를 역추적할 수 없게 한다.
//  - k-익명: 유효표 3표 미만인 발언은 GIC/대표의견에서 제외. 클러스터 size<20 이면 그 클러스터 대표의견 억제.
//  - GIC(Group-Informed Consensus): 그룹별 라플라스 스무딩 찬성확률의 곱 — 전 그룹 고르게 찬성인 발언이 위로.
//    (다수 그룹만으로 상위를 독식하는 "다수 횡포"를 막는다.)
//
// 결정론: clustering.ts 가 결정론적이고, 여기서도 Map 순회 대신 정렬된 배열만 쓴다.
// 같은 입력이면 항상 같은 landscape 가 나온다 (증빙 제품 요구사항).

import {
  buildVoteMatrix,
  filterByMinVotes,
  imputeMeans,
  kmeans,
  pca2d,
  silhouetteScore,
  type Point2D,
  type VoteMatrix,
  type VoteRecord
} from './clustering'
import type { SnapshotPayload } from './metrics'

export type { VoteRecord } from './clustering'

// 비활성 사유 코드 — UI/리포트가 사람 말로 바꿔 쓴다.
export type LandscapeDisabledReason =
  | 'participants_below_minimum' // 유효 참가자 60명 미만
  | 'insufficient_statements' // 발언 2건 미만 (PCA 불가)
  | 'no_valid_k' // 클러스터당 최소 인원(20명)을 만족하는 k 가 없음
  | 'vote_matrix_unavailable' // 개인 표 행렬을 읽을 수 없음 (권한/저장소 제약)

export type LandscapeCluster = {
  id: number
  size: number
  centroid: Point2D
}

// 익명 좌표 — participantId 없음 (의도적).
export type LandscapePoint = { x: number; y: number; cluster: number }

export type GicItem = { statementId: string; score: number }

export type RepresentativeItem = {
  clusterId: number
  statementId: string
  // lift = (그룹 내 찬성확률) - (그룹 밖 찬성확률). 라플라스 스무딩 적용.
  lift: number
  agreeRate: number
}

export type LandscapeResult = {
  enabled: boolean
  reason?: LandscapeDisabledReason
  // 전체 참가자 수 / 최소 투표 임계를 넘긴 유효 참가자 수.
  participantCount: number
  eligibleCount: number
  k: number
  silhouette: number
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
}

const DEFAULTS = {
  minVotesPerParticipant: 7,
  minParticipants: 60,
  largeSessionThreshold: 100,
  minClusterSize: 20,
  maxK: 5,
  kAnonymityThreshold: 3,
  topGic: 10,
  topRepresentativesPerCluster: 3
}

function disabled(reason: LandscapeDisabledReason, participantCount: number, eligibleCount: number): LandscapeResult {
  return {
    enabled: false,
    reason,
    participantCount,
    eligibleCount,
    k: 0,
    silhouette: 0,
    clusters: [],
    projection: [],
    gic: [],
    representatives: []
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

// 라플라스 스무딩 찬성확률 (agree+1)/(votes+2).
function smoothedAgreeProb(agree: number, votes: number): number {
  return (agree + 1) / (votes + 2)
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
  if (eligible.statementIds.length < 2) {
    return disabled('insufficient_statements', participantCount, eligibleCount)
  }

  const imputed = imputeMeans(eligible)
  const projected = pca2d(imputed)

  // k 후보: 60~99명은 k=2 고정, 100명+ 는 2..maxK. 클러스터당 최소 인원을 만족할 수 없는 k 는 사전 배제.
  const candidateKs = (eligibleCount < opt.largeSessionThreshold
    ? [2]
    : Array.from({ length: opt.maxK - 1 }, (_, i) => i + 2)
  ).filter((k) => Math.floor(eligibleCount / k) >= opt.minClusterSize)

  let best: { k: number; labels: number[]; centroids: Point2D[]; score: number } | null = null
  for (const k of candidateKs) {
    const km = kmeans(projected.points, k)
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
    return disabled('no_valid_k', participantCount, eligibleCount)
  }
  const chosen = best

  // 클러스터별 멤버 행 인덱스 (내부 계산 전용 — 출력에 싣지 않는다).
  const memberRows: number[][] = Array.from({ length: chosen.k }, () => [])
  for (let i = 0; i < chosen.labels.length; i += 1) memberRows[chosen.labels[i]].push(i)

  const clusters: LandscapeCluster[] = memberRows.map((rows, id) => ({
    id,
    size: rows.length,
    centroid: chosen.centroids[id] ?? { x: 0, y: 0 }
  }))

  // 익명 좌표 — participantId 미포함 + (cluster, x, y) 정렬로 인덱스 역추적 차단.
  const projection: LandscapePoint[] = projected.points
    .map((p, i) => ({ x: p.x, y: p.y, cluster: chosen.labels[i] }))
    .sort((a, b) => a.cluster - b.cluster || a.x - b.x || a.y - b.y)

  // ── GIC: 모든 그룹의 라플라스 스무딩 찬성확률 곱. 유효표 부족(k-익명) 발언은 제외.
  const gic: GicItem[] = []
  for (let j = 0; j < eligible.statementIds.length; j += 1) {
    const perCluster = memberRows.map((rows) => clusterTally(eligible, rows, j))
    const totalVotes = perCluster.reduce((a, t) => a + t.votes, 0)
    if (totalVotes < opt.kAnonymityThreshold) continue
    let score = 1
    for (const t of perCluster) score *= smoothedAgreeProb(t.agree, t.votes)
    gic.push({ statementId: eligible.statementIds[j], score })
  }
  gic.sort((a, b) => b.score - a.score || (a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0))

  // ── 그룹별 대표 의견: 그룹 안/밖 찬성확률 차이(lift). 표본 부족이면 제외.
  const representatives: RepresentativeItem[] = []
  for (let g = 0; g < chosen.k; g += 1) {
    // 클러스터 size<20 이면 대표의견 억제 (개인 식별 위험). 현재 k 선택 규칙상 발생하지 않지만 명시 방어.
    if (memberRows[g].length < opt.minClusterSize) continue
    const outsideRows: number[] = []
    for (let h = 0; h < chosen.k; h += 1) if (h !== g) outsideRows.push(...memberRows[h])
    outsideRows.sort((a, b) => a - b)

    const items: RepresentativeItem[] = []
    for (let j = 0; j < eligible.statementIds.length; j += 1) {
      const inside = clusterTally(eligible, memberRows[g], j)
      const outside = clusterTally(eligible, outsideRows, j)
      // k-익명: 안/밖 어느 쪽이든 유효표가 임계 미만이면 제외.
      if (inside.votes < opt.kAnonymityThreshold || outside.votes < opt.kAnonymityThreshold) continue
      const pIn = smoothedAgreeProb(inside.agree, inside.votes)
      const pOut = smoothedAgreeProb(outside.agree, outside.votes)
      const lift = pIn - pOut
      if (lift <= 0) continue
      items.push({ clusterId: g, statementId: eligible.statementIds[j], lift, agreeRate: inside.votes > 0 ? inside.agree / inside.votes : 0 })
    }
    items.sort((a, b) => b.lift - a.lift || (a.statementId < b.statementId ? -1 : a.statementId > b.statementId ? 1 : 0))
    representatives.push(...items.slice(0, opt.topRepresentativesPerCluster))
  }

  return {
    enabled: true,
    participantCount,
    eligibleCount,
    k: chosen.k,
    silhouette: chosen.score,
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
      return '발언이 2건 미만이라 의견 지형을 계산할 수 없습니다'
    case 'no_valid_k':
      return '클러스터당 최소 인원(20명)을 만족하는 그룹 구분을 찾지 못했습니다'
    case 'vote_matrix_unavailable':
      return '개인 표 행렬 접근 권한이 없어 의견 지형을 계산하지 않았습니다'
    default:
      return '의견 지형이 계산되지 않았습니다'
  }
}

// 접근 불가(권한/저장소 제약) 상태를 명시적으로 만든다 — 빈 행렬로 조용히 계산하지 않기 위해.
export function landscapeUnavailable(participantCount: number): LandscapeResult {
  return disabled('vote_matrix_unavailable', participantCount, 0)
}
