// Lecture LiveOps — 의견 지형 클러스터링 커널 (Post-MVP B)
// Polis 방식(투표행렬 → 결측 평균대체 → PCA 2D → K-means)을 순수 TS 로 구현한다. 외부 의존성 0.
//
// 결정론(determinism)이 하드 요구사항이다:
//   Polis 자체는 warm-start 상태를 들고 다녀 재실행 시 결과가 달라지지만(비결정론),
//   우리 제품은 "절차 증빙형 납품물"이라 리포트를 재생성했을 때 결과가 달라지면 안 된다.
//   → 고정 시드 PRNG(k-means++), 고정 반복 순서, Map 순회 대신 정렬된 배열, 고유벡터 부호 규약 고정.
//   같은 입력이면 항상 같은 출력 (tests/unit/delib-clustering.test.ts 가 강제).
//
// 개인 표 원자료는 이 모듈의 입력으로만 쓰이고 출력에는 절대 실리지 않는다 (거버넌스 §7-2).
// 좌표 배열에 participantId 를 넣지 않는 것은 상위 landscapeMetrics 가 책임진다.

export type ClusterVoteValue = 'agree' | 'disagree' | 'pass'

// 클러스터링 입력용 개인 표 1건. 서버 메모리 안에서만 사용한다.
export type VoteRecord = {
  participantId: string
  statementId: string
  vote: ClusterVoteValue
}

export type Point2D = { x: number; y: number }

// 투표행렬 — values[i][j] 는 participantIds[i] 가 statementIds[j] 에 던진 표.
// agree=+1 / disagree=-1 / pass=0 / 미투표=null(결측).
export type VoteMatrix = {
  participantIds: string[]
  statementIds: string[]
  values: Array<Array<number | null>>
}

export type Pca2dResult = {
  points: Point2D[]
  // 주성분 2개 (각각 길이 d). 부호 규약: |값| 최대인 성분이 양수가 되도록 고정.
  components: [number[], number[]]
  // 각 주성분의 고유값 (분산). 설명력 비교용.
  eigenvalues: [number, number]
}

export type KmeansResult = {
  // labels[i] 는 points[i] 가 속한 클러스터 id (0..k-1).
  labels: number[]
  centroids: Point2D[]
  iterations: number
  converged: boolean
}

const VOTE_SCORE: Record<ClusterVoteValue, number> = { agree: 1, disagree: -1, pass: 0 }

const POWER_ITER_MAX = 500
const POWER_ITER_EPS = 1e-12
const KMEANS_ITER_MAX = 100

// ------------------------------------------------------------
// 결정론적 PRNG (mulberry32) — 정수 연산만 쓰므로 엔진과 무관하게 같은 시퀀스를 낸다.
// Math.random 은 물론 Math.sin 같은 초월함수(엔진별 구현 차이)도 쓰지 않는다.
// ------------------------------------------------------------
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 문자열 정렬 비교 — localeCompare 는 로케일 의존이라 쓰지 않는다 (결정론).
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ------------------------------------------------------------
// 1) 투표행렬
// ------------------------------------------------------------
// participantIds/statementIds 는 정렬해서 고정한다 — 입력 순서가 결과에 영향을 주지 않게.
// 같은 (participant, statement) 표가 중복으로 들어오면 마지막 값이 이긴다 (upsert 시맨틱).
export function buildVoteMatrix(
  votes: VoteRecord[],
  statementIds: string[],
  participantIds: string[]
): VoteMatrix {
  const sortedStatements = [...new Set(statementIds)].sort(byCodeUnit)
  const sortedParticipants = [...new Set(participantIds)].sort(byCodeUnit)
  const rowIndex = new Map(sortedParticipants.map((p, i) => [p, i] as const))
  const colIndex = new Map(sortedStatements.map((s, j) => [s, j] as const))

  const values: Array<Array<number | null>> = sortedParticipants.map(() =>
    new Array<number | null>(sortedStatements.length).fill(null)
  )
  for (const v of votes) {
    const i = rowIndex.get(v.participantId)
    const j = colIndex.get(v.statementId)
    if (i === undefined || j === undefined) continue
    values[i][j] = VOTE_SCORE[v.vote] ?? 0
  }
  return { participantIds: sortedParticipants, statementIds: sortedStatements, values }
}

// 참가자별 실제 투표 수 (결측 제외). 최소 투표 임계 필터에 쓴다.
export function voteCounts(matrix: VoteMatrix): number[] {
  return matrix.values.map((row) => row.reduce((n: number, v) => (v == null ? n : n + 1), 0))
}

// 최소 투표 수 미만인 참가자를 행렬에서 제외한다 (Polis 기준 7표).
export function filterByMinVotes(matrix: VoteMatrix, minVotes: number): VoteMatrix {
  const counts = voteCounts(matrix)
  const keep: number[] = []
  for (let i = 0; i < counts.length; i += 1) if (counts[i] >= minVotes) keep.push(i)
  return {
    participantIds: keep.map((i) => matrix.participantIds[i]),
    statementIds: matrix.statementIds,
    values: keep.map((i) => matrix.values[i])
  }
}

// ------------------------------------------------------------
// 2) 결측치 평균 대체 — statement(열) 별 관측 평균으로 채운다. 관측이 하나도 없으면 0.
// ------------------------------------------------------------
export function imputeMeans(matrix: VoteMatrix): number[][] {
  const n = matrix.values.length
  const d = matrix.statementIds.length
  const means = new Array<number>(d).fill(0)
  for (let j = 0; j < d; j += 1) {
    let sum = 0
    let cnt = 0
    for (let i = 0; i < n; i += 1) {
      const v = matrix.values[i][j]
      if (v == null) continue
      sum += v
      cnt += 1
    }
    means[j] = cnt > 0 ? sum / cnt : 0
  }
  return matrix.values.map((row) => row.map((v, j) => (v == null ? means[j] : v)))
}

// ------------------------------------------------------------
// 3) PCA 2D — 공분산 행렬 + power iteration(+deflation). 결정론적.
// ------------------------------------------------------------
function columnMeans(rows: number[][]): number[] {
  const n = rows.length
  const d = n > 0 ? rows[0].length : 0
  const means = new Array<number>(d).fill(0)
  if (n === 0) return means
  for (let i = 0; i < n; i += 1) for (let j = 0; j < d; j += 1) means[j] += rows[i][j]
  for (let j = 0; j < d; j += 1) means[j] /= n
  return means
}

function covariance(centered: number[][]): number[][] {
  const n = centered.length
  const d = n > 0 ? centered[0].length : 0
  const denom = n > 1 ? n - 1 : 1
  const cov: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  for (let i = 0; i < n; i += 1) {
    const row = centered[i]
    for (let a = 0; a < d; a += 1) {
      const va = row[a]
      if (va === 0) continue
      for (let b = a; b < d; b += 1) {
        cov[a][b] += va * row[b]
      }
    }
  }
  for (let a = 0; a < d; a += 1) {
    for (let b = a; b < d; b += 1) {
      const v = cov[a][b] / denom
      cov[a][b] = v
      cov[b][a] = v
    }
  }
  return cov
}

function matVec(m: number[][], v: number[]): number[] {
  const d = v.length
  const out = new Array<number>(d).fill(0)
  for (let a = 0; a < d; a += 1) {
    let s = 0
    const row = m[a]
    for (let b = 0; b < d; b += 1) s += row[b] * v[b]
    out[a] = s
  }
  return out
}

function norm(v: number[]): number {
  let s = 0
  for (const x of v) s += x * x
  return Math.sqrt(s)
}

// 고유벡터 부호 규약 — |값| 이 최대인 성분을 양수로 고정 (동률이면 앞 인덱스 우선).
// power iteration 의 초기벡터가 무엇이든 최종 부호가 하나로 결정되게 한다.
function canonicalSign(v: number[]): number[] {
  let best = 0
  for (let i = 1; i < v.length; i += 1) {
    if (Math.abs(v[i]) > Math.abs(v[best]) + 1e-15) best = i
  }
  return v[best] < 0 ? v.map((x) => -x) : v
}

// 최대 고유쌍 (power iteration). 초기벡터는 고정 시드 PRNG — 결정론적.
function dominantEigen(m: number[][], seed: number, scale = 0): { vector: number[]; value: number } {
  const d = m.length
  if (d === 0) return { vector: [], value: 0 }
  // 영(0) 판정 임계 — 디플레이션 잔차(부동소수점 noise)를 실제 축으로 착각하지 않게 스케일 상대값을 쓴다.
  const zeroTol = Math.max(POWER_ITER_EPS, Math.abs(scale) * 1e-9)
  const rng = createRng(seed)
  let v = new Array<number>(d).fill(0).map(() => rng() * 2 - 1)
  let len = norm(v)
  if (len === 0) {
    v = new Array<number>(d).fill(0)
    v[0] = 1
    len = 1
  }
  v = v.map((x) => x / len)

  for (let iter = 0; iter < POWER_ITER_MAX; iter += 1) {
    const next = matVec(m, v)
    const nlen = norm(next)
    // 분산이 남아있지 않은 축 — 방향을 임의로 고르지 않고 영벡터를 돌려준다(투영값 0).
    if (nlen < zeroTol) return { vector: new Array<number>(d).fill(0), value: 0 }
    const normalized = next.map((x) => x / nlen)
    // 수렴 판정: 방향 변화량 (부호 반전 허용).
    let dot = 0
    for (let i = 0; i < d; i += 1) dot += normalized[i] * v[i]
    v = normalized
    if (Math.abs(Math.abs(dot) - 1) < POWER_ITER_EPS) break
  }
  // Rayleigh quotient 로 고유값 확정 (부호 포함).
  const mv = matVec(m, v)
  let rayleigh = 0
  for (let i = 0; i < d; i += 1) rayleigh += v[i] * mv[i]
  return { vector: canonicalSign(v), value: rayleigh }
}

// 상위 2개 주성분으로 각 행을 2D 로 투영한다.
export function pca2d(rows: number[][]): Pca2dResult {
  const n = rows.length
  const d = n > 0 ? rows[0].length : 0
  if (n === 0 || d === 0) {
    return { points: rows.map(() => ({ x: 0, y: 0 })), components: [[], []], eigenvalues: [0, 0] }
  }
  const means = columnMeans(rows)
  const centered = rows.map((r) => r.map((v, j) => v - means[j]))
  const cov = covariance(centered)

  const first = dominantEigen(cov, 0x5eed0001)
  // deflation: C' = C - λ v vᵀ → 2번째 주성분.
  const deflated = cov.map((row, a) => row.map((v, b) => v - first.value * first.vector[a] * first.vector[b]))
  const second = d > 1 ? dominantEigen(deflated, 0x5eed0002, first.value) : { vector: new Array<number>(d).fill(0), value: 0 }

  const points = centered.map((r) => {
    let x = 0
    let y = 0
    for (let j = 0; j < d; j += 1) {
      x += r[j] * (first.vector[j] ?? 0)
      y += r[j] * (second.vector[j] ?? 0)
    }
    return { x, y }
  })
  return {
    points,
    components: [first.vector, second.vector],
    eigenvalues: [first.value, second.value]
  }
}

// ------------------------------------------------------------
// 4) K-means (k-means++ 고정 시드 초기화) — 결정론적.
// ------------------------------------------------------------
function dist2(a: Point2D, b: Point2D): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function kmeansPlusPlusInit(points: Point2D[], k: number, seed: number): Point2D[] {
  const rng = createRng(seed)
  const centers: Point2D[] = []
  // 첫 중심: 시드 PRNG 로 하나 선택.
  const firstIdx = Math.min(points.length - 1, Math.floor(rng() * points.length))
  centers.push({ ...points[firstIdx] })
  while (centers.length < k) {
    // D²(x) 가중 샘플링. 누적합 순회는 인덱스 오름차순 고정 → 결정론적.
    const d2 = points.map((p) => {
      let best = Infinity
      for (const c of centers) best = Math.min(best, dist2(p, c))
      return best
    })
    const total = d2.reduce((a, b) => a + b, 0)
    if (total <= 0) {
      // 모든 점이 기존 중심과 동일 — 남은 중심은 첫 점 복제 (퇴화 케이스, 결정론 유지).
      centers.push({ ...points[0] })
      continue
    }
    const target = rng() * total
    let acc = 0
    let chosen = points.length - 1
    for (let i = 0; i < points.length; i += 1) {
      acc += d2[i]
      if (acc >= target) {
        chosen = i
        break
      }
    }
    centers.push({ ...points[chosen] })
  }
  return centers
}

// 클러스터 id 를 centroid 좌표 기준(x → y)으로 재정렬한다.
// 초기화 순서에 따라 id 가 뒤바뀌는 것을 막아 출력 라벨까지 결정론적으로 만든다.
function relabelDeterministically(labels: number[], centroids: Point2D[]): { labels: number[]; centroids: Point2D[] } {
  const order = centroids.map((c, i) => ({ c, i })).sort((a, b) => a.c.x - b.c.x || a.c.y - b.c.y || a.i - b.i)
  const remap = new Array<number>(centroids.length).fill(0)
  order.forEach((entry, newId) => {
    remap[entry.i] = newId
  })
  return {
    labels: labels.map((l) => remap[l]),
    centroids: order.map((entry) => entry.c)
  }
}

export function kmeans(points: Point2D[], k: number, seed = 0x5eedbeef): KmeansResult {
  if (points.length === 0 || k <= 0) {
    return { labels: [], centroids: [], iterations: 0, converged: true }
  }
  const effectiveK = Math.min(k, points.length)
  let centroids = kmeansPlusPlusInit(points, effectiveK, seed)
  let labels = new Array<number>(points.length).fill(0)
  let converged = false
  let iterations = 0

  for (let iter = 0; iter < KMEANS_ITER_MAX; iter += 1) {
    iterations = iter + 1
    // 할당 — 동률 거리면 낮은 클러스터 id 우선 (결정론).
    const nextLabels = points.map((p) => {
      let best = 0
      let bestD = dist2(p, centroids[0])
      for (let c = 1; c < centroids.length; c += 1) {
        const d = dist2(p, centroids[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      return best
    })
    const changed = nextLabels.some((l, i) => l !== labels[i]) || iter === 0
    labels = nextLabels
    // 중심 갱신 — 빈 클러스터는 이전 중심 유지 (결정론).
    const sums = centroids.map(() => ({ x: 0, y: 0, n: 0 }))
    for (let i = 0; i < points.length; i += 1) {
      const s = sums[labels[i]]
      s.x += points[i].x
      s.y += points[i].y
      s.n += 1
    }
    centroids = centroids.map((c, idx) => (sums[idx].n > 0 ? { x: sums[idx].x / sums[idx].n, y: sums[idx].y / sums[idx].n } : c))
    if (!changed) {
      converged = true
      break
    }
  }

  const relabeled = relabelDeterministically(labels, centroids)
  return { labels: relabeled.labels, centroids: relabeled.centroids, iterations, converged }
}

// ------------------------------------------------------------
// 5) 실루엣 점수 — k 선택 기준. -1..1, 클수록 잘 분리됨.
// ------------------------------------------------------------
export function silhouetteScore(points: Point2D[], labels: number[], k: number): number {
  if (points.length === 0 || k < 2) return 0
  const members: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] >= 0 && labels[i] < k) members[labels[i]].push(i)
  }
  let sum = 0
  let counted = 0
  for (let i = 0; i < points.length; i += 1) {
    const own = members[labels[i]]
    if (own.length <= 1) {
      counted += 1
      continue // s = 0
    }
    let a = 0
    for (const j of own) {
      if (j === i) continue
      a += Math.sqrt(dist2(points[i], points[j]))
    }
    a /= own.length - 1

    let b = Infinity
    for (let c = 0; c < k; c += 1) {
      if (c === labels[i] || members[c].length === 0) continue
      let acc = 0
      for (const j of members[c]) acc += Math.sqrt(dist2(points[i], points[j]))
      b = Math.min(b, acc / members[c].length)
    }
    if (!Number.isFinite(b)) {
      counted += 1
      continue
    }
    const denom = Math.max(a, b)
    sum += denom > 0 ? (b - a) / denom : 0
    counted += 1
  }
  return counted > 0 ? sum / counted : 0
}
