// Lecture LiveOps — 순수 TS 통계 유틸 (외부 패키지 0)
//
// 의견 지형(landscape)의 "그럴듯한 가짜 결과"를 막기 위한 유의성 검정 도구 모음이다.
// 이중 검증(2026-07-22) C4 실측: 그룹 간 진짜 차이가 전무한 귀무가설에서도
// lift>0 규칙만 쓰면 100.0% 확률로 대표의견이 뽑혔다(1000 trials).
// → 원시 카운트 기반 검정 + 다중비교(FDR) 보정이 필수다.
//
// 모든 함수는 결정론적이다 (난수 미사용). 같은 입력이면 항상 같은 출력.

// ------------------------------------------------------------
// 정규분포
// ------------------------------------------------------------

// erfc 근사 (Numerical Recipes 'erfcc', 상대오차 ~1.2e-7).
// p=0.05 근처 판정에 충분한 정밀도이고 초월함수는 exp 만 쓴다.
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 2 / (2 + z)
  const ty = 4 * t - 2
  const coeffs = [
    -1.3026537197817094, 6.4196979235649026e-1, 1.9476473204185836e-2, -9.561514786808631e-3,
    -9.46595344482036e-4, 3.66839497852761e-4, 4.2523324806907e-5, -2.0278578112534e-5,
    -1.624290004647e-6, 1.303655835580e-6, 1.5626441722e-8, -8.5238095915e-8,
    6.529054439e-9, 5.059343495e-9, -9.91364156e-10, -2.27365122e-10,
    9.6467911e-11, 2.394038e-12, -6.886027e-12, 8.94487e-13,
    3.13092e-13, -1.12708e-13, 3.81e-16, 7.106e-15
  ]
  let d = 0
  let dd = 0
  for (let j = coeffs.length - 1; j > 0; j -= 1) {
    const tmp = d
    d = ty * d - dd + coeffs[j]
    dd = tmp
  }
  const ans = t * Math.exp(-z * z + 0.5 * (coeffs[0] + ty * d) - dd)
  return x >= 0 ? ans : 2 - ans
}

// 표준정규 누적분포.
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

// ------------------------------------------------------------
// 두 비율 비교 (two-proportion z-test, 양측)
// ------------------------------------------------------------

export type ProportionTest = {
  // 'z' = 정규근사, 'fisher' = 정확검정(기대셀 < 5 인 소표본).
  method: 'z' | 'fisher'
  pValue: number
}

// 기대빈도 최소값. 5 미만이면 정규근사가 무너지므로 Fisher 정확검정으로 전환한다.
function minExpectedCell(a1: number, n1: number, a2: number, n2: number): number {
  const n = n1 + n2
  if (n === 0) return 0
  const rowA = a1 + a2
  const rowB = n - rowA
  return Math.min((rowA * n1) / n, (rowA * n2) / n, (rowB * n1) / n, (rowB * n2) / n)
}

// 풀링된 비율을 쓰는 표준 two-proportion z-test (양측 p).
export function twoProportionZ(a1: number, n1: number, a2: number, n2: number): number {
  if (n1 <= 0 || n2 <= 0) return 1
  const p = (a1 + a2) / (n1 + n2)
  if (p <= 0 || p >= 1) return 1
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2))
  if (se <= 0) return 1
  const z = (a1 / n1 - a2 / n2) / se
  return 2 * (1 - normalCdf(Math.abs(z)))
}

const LOG_FACT: number[] = [0]
function logFactorial(n: number): number {
  if (n < 0) return 0
  for (let i = LOG_FACT.length; i <= n; i += 1) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i)
  return LOG_FACT[n]
}

// 2×2 초기하 확률 (행/열 합 고정).
function hyperProb(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d
  return Math.exp(
    logFactorial(a + b) + logFactorial(c + d) + logFactorial(a + c) + logFactorial(b + d) -
      logFactorial(n) - logFactorial(a) - logFactorial(b) - logFactorial(c) - logFactorial(d)
  )
}

// Fisher 정확검정 (양측) — 관측 테이블 이하 확률을 갖는 모든 테이블의 확률 합.
export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d
  if (n <= 0) return 1
  const row1 = a + b
  const col1 = a + c
  const observed = hyperProb(a, b, c, d)
  // 부동소수점 동률을 관대하게 포함 (표준 구현 관행).
  const tol = observed * 1e-7
  const lo = Math.max(0, col1 - (n - row1))
  const hi = Math.min(row1, col1)
  let sum = 0
  for (let x = lo; x <= hi; x += 1) {
    const p = hyperProb(x, row1 - x, col1 - x, n - row1 - col1 + x)
    if (p <= observed + tol) sum += p
  }
  return Math.min(1, sum)
}

// 두 비율 차이 검정 — 기대셀이 작으면 자동으로 Fisher 로 전환한다.
export function proportionDiffTest(insideAgree: number, insideVotes: number, outsideAgree: number, outsideVotes: number): ProportionTest {
  if (insideVotes <= 0 || outsideVotes <= 0) return { method: 'fisher', pValue: 1 }
  if (minExpectedCell(insideAgree, insideVotes, outsideAgree, outsideVotes) < 5) {
    return {
      method: 'fisher',
      pValue: fisherExactTwoSided(insideAgree, insideVotes - insideAgree, outsideAgree, outsideVotes - outsideAgree)
    }
  }
  return { method: 'z', pValue: twoProportionZ(insideAgree, insideVotes, outsideAgree, outsideVotes) }
}

// ------------------------------------------------------------
// Benjamini-Hochberg FDR 보정
// ------------------------------------------------------------
// 세션 하나에서 (클러스터 × 발언) 개의 검정을 동시에 돌리므로 무보정 p 는 무의미하다.
// 입력 순서를 보존한 adjusted p 배열을 돌려준다 (step-up + 단조성 강제).
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length
  if (m === 0) return []
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p || a.i - b.i)
  const adjusted = new Array<number>(m).fill(1)
  let running = 1
  for (let rank = m; rank >= 1; rank -= 1) {
    const entry = order[rank - 1]
    running = Math.min(running, (entry.p * m) / rank)
    adjusted[entry.i] = Math.min(1, running)
  }
  return adjusted
}

// ------------------------------------------------------------
// Wilson 점수 신뢰구간 — 소표본 비율에 정규근사(Wald)보다 정직하다.
// ------------------------------------------------------------
export function wilsonInterval(successes: number, total: number, z = 1.959963984540054): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 1 }
  const p = successes / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const center = (p + z2 / (2 * total)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

// ------------------------------------------------------------
// 백분위 (정렬된 표본에서 선형보간) — 순열검정 임계값 계산용.
// ------------------------------------------------------------
export function percentile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length
  if (n === 0) return 0
  if (n === 1) return sortedAsc[0]
  const pos = (n - 1) * Math.min(1, Math.max(0, q))
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedAsc[lo]
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo)
}
