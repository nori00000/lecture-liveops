// Lecture LiveOps — 자연어 좌석 명령 결정론 파서 (트랙 A)
// 순수 함수: LLM 없이 즉답. 전혀 해석 불가(null)일 때만 트랙 B LLM fallback으로 넘긴다.
// 좌석 식별: "3-2" | "3조/3팀 2번" | "3조2번"/"3팀2번" | 맨숫자 1..48(전역 번호) | "3조"/"3팀"/"3팀 전체"(테이블 단위)
// "조"와 "팀"은 동의어 — 배치도 라벨(N조/N팀 또는 A-N팀)에 상관없이 N번째 테이블로 해석한다.
// 인텐트: 문제/막힘/안됨/오류/에러 → problem(기본값) · 해결/완료/됐/풀림 → resolved · 초기화/리셋/취소 → clear

import type { AssistPlan } from '@/lib/assist/types'

/** 전역 좌석 번호 → 키 변환 기준. 실제 배치도 seatKeys에서 조당 좌석 수를 유추한다(4/5/6석 배치도 대응).
 *  변환 결과는 항상 seatKeys로 재검증하므로 유추가 빗나가도 유효 키만 통과한다. */
const DEFAULT_SEATS_PER_TABLE = 6

function deriveSeatsPerTable(seatKeys: readonly string[]): number {
  let max = 0
  for (const k of seatKeys) {
    const m = k.match(/-(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return max > 0 ? max : DEFAULT_SEATS_PER_TABLE
}

const INTENT_CLEAR = /초기화|리셋|취소/
const INTENT_PROBLEM_NEG = /안\s*됨|안\s*돼|안\s*됐/
const INTENT_RESOLVED = /해결|완료|됐|풀림|풀렸/
const INTENT_PROBLEM = /문제|막힘|막혔|오류|에러/
/** "안 돼요"처럼 분리된 인텐트 조각 — memo로 흘러가지 않게 소비만 한다. */
const INTENT_FRAGMENT = /^(안|돼요?|됩니다|됨)$/

const REASON_RULES: { reason: string; keywords: string[] }[] = [
  { reason: 'install', keywords: ['설치'] },
  { reason: 'network', keywords: ['네트워크', 'ssl', '와이파이', '인터넷'] },
  { reason: 'account', keywords: ['계정', '구독', '로그인'] },
  { reason: 'pace', keywords: ['진도', '느려', '느리', '느림', '못따라'] },
  { reason: 'device', keywords: ['기기', '노트북', '장비'] }
]

/** ops log/응답 메시지용 한국어 사유 라벨. */
export const REASON_LABEL_KO: Record<string, string> = {
  install: '설치',
  network: '네트워크',
  account: '계정',
  pace: '진도',
  device: '기기',
  etc: '기타'
}

const WHOLE_MARKERS = new Set(['전체', '다', '모두', '전부'])
const CONNECTIVES = new Set(['와', '과', '랑', '이랑', '하고', '그리고', '및'])

type ParseCtx = {
  valid: ReadonlySet<string>
  orderedKeys: readonly string[]
  seatKeys: string[]
  unmatched: string[]
  memo: string[]
  reason?: string
  /** 배치도 seatKeys에서 유추한 조당 좌석 수 — 전역 번호 변환 기준. */
  seatsPerTable: number
  /** 직전에 조-명시 표현("3조 1번"/"3-2"/"3조")이 세운 조 번호 — 후속 맨숫자("3번")가 상속한다. */
  lastTable?: number
}

/** 명령 텍스트 → 실행 계획. 좌석/인텐트를 전혀 못 찾으면 null(LLM fallback 대상). */
export function parseCommand(text: string, seatKeys: readonly string[]): AssistPlan | null {
  const ctx: ParseCtx = {
    valid: new Set(seatKeys),
    orderedKeys: seatKeys,
    seatKeys: [],
    unmatched: [],
    memo: [],
    seatsPerTable: deriveSeatsPerTable(seatKeys)
  }
  const tokens = tokenize(text)
  for (let i = 0; i < tokens.length; ) {
    const consumed = tryConsumeSeat(tokens, i, ctx)
    if (consumed > 0) {
      i += consumed
      continue
    }
    classifyToken(tokens[i], ctx)
    i += 1
  }

  const explicit = detectIntent(text)
  const hasSeatish = ctx.seatKeys.length > 0 || ctx.unmatched.length > 0
  const intent = explicit ?? (hasSeatish ? 'problem' : null)
  if (intent === null) return null
  if (intent !== 'clear' && !hasSeatish) return null

  const memo = ctx.memo.join(' ').trim()
  return {
    intent,
    seatKeys: ctx.seatKeys,
    ...(ctx.reason ? { reason: ctx.reason } : {}),
    ...(memo ? { memo } : {}),
    unmatched: ctx.unmatched
  }
}

/** 명시 인텐트 검출 — clear > 부정형(안됨=problem) > resolved > problem 순. 없으면 null. */
function detectIntent(text: string): AssistPlan['intent'] | null {
  if (INTENT_CLEAR.test(text)) return 'clear'
  if (INTENT_PROBLEM_NEG.test(text)) return 'problem'
  if (INTENT_RESOLVED.test(text)) return 'resolved'
  if (INTENT_PROBLEM.test(text)) return 'problem'
  return null
}

function tokenize(text: string): string[] {
  return text
    .replace(/[,，·]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0)
}

/** "14와" → "14" — 연결조사는 좌석 패턴 재시도 전에만 벗긴다. */
function stripConnective(token: string): string {
  const m = token.match(/^(.+?)(?:와|과|랑|이랑|하고)$/)
  return m ? m[1] : token
}

/** tokens[i]부터 좌석 표현을 해석한다. 소비한 토큰 수를 반환(0 = 좌석 아님). */
function tryConsumeSeat(tokens: string[], i: number, ctx: ParseCtx): number {
  const raw = tokens[i]
  const tok = stripConnective(raw)

  const pair = tok.match(/^(\d+)-(\d+)$/)
  if (pair) {
    ctx.lastTable = parseInt(pair[1], 10)
    addSeat(ctx, seatKeyOf(pair[1], pair[2]), raw)
    return 1
  }
  // "조"와 "팀"은 동의어 — 배치도 라벨이 "N조"이든 "N팀"이든 같은 테이블로 해석한다.
  const joCompact = tok.match(/^(\d+)(?:조|팀)(\d+)번?$/)
  if (joCompact) {
    ctx.lastTable = parseInt(joCompact[1], 10)
    addSeat(ctx, seatKeyOf(joCompact[1], joCompact[2]), raw)
    return 1
  }
  const jo = tok.match(/^(\d+)(?:조|팀)$/)
  if (jo) return consumeJoToken(tokens, i, jo[1], raw, ctx)

  const bare = tok.match(/^(\d+)번?$/)
  if (bare) {
    const n = parseInt(bare[1], 10)
    // 조 맥락이 살아 있고 조 내 좌석 범위면 맥락 상속 ("3조 1번 3번" → 3-3)
    if (ctx.lastTable !== undefined && n >= 1 && n <= ctx.seatsPerTable) {
      addSeat(ctx, `${ctx.lastTable}-${n}`, raw)
    } else {
      addGlobalNumber(ctx, n, raw)
    }
    return 1
  }
  return 0
}

/** "N조" + 후속 토큰 처리 — "N조 2번"/"N조 2"는 좌석 1개, "N조 (전체|다|모두)"/"N조"는 조 전체. */
function consumeJoToken(tokens: string[], i: number, joNum: string, raw: string, ctx: ParseCtx): number {
  ctx.lastTable = parseInt(joNum, 10)
  const next = i + 1 < tokens.length ? stripConnective(tokens[i + 1]) : ''
  // 명시적 "N번"은 범위 가드 없이 짝지어 키 검증으로 판정 ("3조 9번" → unmatched)
  const withBeon = next.match(/^(\d+)번$/)
  if (withBeon) {
    addSeat(ctx, seatKeyOf(joNum, withBeon[1]), `${raw} ${tokens[i + 1]}`)
    return 2
  }
  // 맨숫자는 1..조당좌석수 범위일 때만 짝으로 본다 ("3조 14"의 14는 전역 번호로 남긴다)
  const bareNum = next.match(/^(\d+)$/)
  if (bareNum && parseInt(bareNum[1], 10) >= 1 && parseInt(bareNum[1], 10) <= ctx.seatsPerTable) {
    addSeat(ctx, seatKeyOf(joNum, bareNum[1]), `${raw} ${tokens[i + 1]}`)
    return 2
  }
  addTableSeats(ctx, parseInt(joNum, 10), raw)
  return WHOLE_MARKERS.has(next) ? 2 : 1
}

function seatKeyOf(table: string, seat: string): string {
  return `${parseInt(table, 10)}-${parseInt(seat, 10)}`
}

/** 맨숫자 n → 조=ceil(n/6), 번호=((n-1)%6)+1. 키가 레이아웃에 없으면(예: 49) unmatched. */
function addGlobalNumber(ctx: ParseCtx, n: number, raw: string): void {
  if (n < 1) {
    ctx.unmatched = [...ctx.unmatched, raw]
    return
  }
  const table = Math.ceil(n / ctx.seatsPerTable)
  const seat = ((n - 1) % ctx.seatsPerTable) + 1
  addSeat(ctx, `${table}-${seat}`, raw)
}

function addSeat(ctx: ParseCtx, key: string, raw: string): void {
  if (!ctx.valid.has(key)) {
    ctx.unmatched = [...ctx.unmatched, raw]
    return
  }
  if (!ctx.seatKeys.includes(key)) ctx.seatKeys = [...ctx.seatKeys, key]
}

/** 조 전체 — 레이아웃 키 순서를 유지하며 해당 조 좌석을 모두 추가한다. */
function addTableSeats(ctx: ParseCtx, table: number, raw: string): void {
  const keys = ctx.orderedKeys.filter((k) => k.startsWith(`${table}-`))
  if (keys.length === 0) {
    ctx.unmatched = [...ctx.unmatched, raw]
    return
  }
  for (const k of keys) {
    if (!ctx.seatKeys.includes(k)) ctx.seatKeys = [...ctx.seatKeys, k]
  }
}

/** 좌석이 아닌 토큰 분류: 사유 → 인텐트(소비) → 연결어(소비) → memo. */
function classifyToken(token: string, ctx: ParseCtx): void {
  const reason = matchReason(token)
  // 첫 사유만 reason에 담고, 이후 사유 키워드 토큰은 소비하지 않고 memo로 흘려보낸다(누락 방지).
  if (reason && !ctx.reason) {
    ctx.reason = reason
    return
  }
  if (isIntentToken(token) || CONNECTIVES.has(token)) return
  ctx.memo = [...ctx.memo, token]
}

/** 토큰 단위 사유 매핑 — 키워드 + 짧은 조사(2자 이하)만 사유로 본다.
 *  "SSL이었음"(잔여 3자)은 사유가 아니라 memo로 남긴다 (해결 메모 시나리오). */
function matchReason(token: string): string | null {
  const t = token.toLowerCase()
  for (const rule of REASON_RULES) {
    for (const kw of rule.keywords) {
      if (t.startsWith(kw) && t.length - kw.length <= 2) return rule.reason
    }
  }
  return null
}

function isIntentToken(token: string): boolean {
  return (
    INTENT_CLEAR.test(token) ||
    INTENT_PROBLEM_NEG.test(token) ||
    INTENT_RESOLVED.test(token) ||
    INTENT_PROBLEM.test(token) ||
    INTENT_FRAGMENT.test(token)
  )
}
