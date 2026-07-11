import type { SeatLayoutConfig, SeatMark, SeatStatus, SeatTable } from './types'

export const STATUS_LABEL: Record<SeatStatus, string> = {
  none: '정상',
  problem: '문제',
  resolved: '해결'
}

/** 프리셋 문제 사유 — value는 서버 저장 키(영문, max 20), label은 표시용 한국어. */
export const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'install', label: '설치' },
  { value: 'network', label: '네트워크/SSL' },
  { value: 'account', label: '계정/구독' },
  { value: 'pace', label: '진도' },
  { value: 'device', label: '기기' },
  { value: 'etc', label: '기타' }
]

export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return ''
  return REASON_OPTIONS.find((o) => o.value === reason)?.label ?? reason
}

/** updated_at 기준 경과 분. 시각이 없거나 깨졌으면 null. */
export function elapsedMinutes(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 60_000))
}

/** 문제 칩 텍스트 — 예: "3-2 설치 · 7분" (사유/경과 없으면 해당 부분 생략). */
export function problemChipLabel(
  tableLabel: string | null,
  seatKey: string,
  reason: string | null | undefined,
  minutes: number | null
): string {
  const key = tableLabel ? `${tableLabel}-${seatNumber(seatKey)}` : seatNumber(seatKey)
  const label = reasonLabel(reason)
  const withReason = label ? `${key} ${label}` : key
  return minutes !== null && minutes >= 1 ? `${withReason} · ${minutes}분` : withReason
}

/** key의 마지막 숫자 그룹을 좌석 번호로 사용한다 (예: "table_3-2" -> "2"). */
export function seatNumber(key: string): string {
  const m = key.match(/(\d+)(?!.*\d)/)
  return m ? String(parseInt(m[1], 10)) : key
}

export function seatAriaLabel(tableLabel: string, seatKey: string, status: SeatStatus): string {
  return `${tableLabel} ${seatNumber(seatKey)}번 자리, ${STATUS_LABEL[status]}`
}

export function findTableBySeat(layout: SeatLayoutConfig, seatKey: string): SeatTable | null {
  return layout.tables.find((t) => t.seats.some((s) => s.key === seatKey)) ?? null
}

export function countSeats(layout: SeatLayoutConfig): number {
  return layout.tables.reduce((n, t) => n + t.seats.length, 0)
}

/** 낙관적 업데이트용 — marks 배열을 불변으로 갱신한다.
 *  서버 upsert는 미전달 reason/memo를 ''로 덮으므로 낙관 상태도 동일하게 비운다. */
export function upsertMark(
  marks: SeatMark[],
  seatKey: string,
  status: SeatStatus,
  extra?: { reason?: string; memo?: string }
): SeatMark[] {
  const now = new Date().toISOString()
  const reason = extra?.reason ?? null
  const memo = extra?.memo ?? null
  const exists = marks.some((m) => m.seat_key === seatKey)
  if (!exists) {
    return [...marks, { seat_key: seatKey, status, reason, memo, updated_by: null, updated_at: now }]
  }
  return marks.map((m) =>
    m.seat_key === seatKey ? { ...m, status, reason, memo, updated_at: now } : m
  )
}

export function sortMarksBySeat(marks: SeatMark[]): SeatMark[] {
  return [...marks].sort((a, b) => a.seat_key.localeCompare(b.seat_key, 'ko', { numeric: true }))
}

export function countResolved(marks: SeatMark[]): number {
  return marks.filter((m) => m.status === 'resolved').length
}

function markTime(m: SeatMark): number {
  if (!m.updated_at) return 0
  const t = new Date(m.updated_at).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** 최장 경과(가장 오래된 updated_at) 마크 — 시각 없는 마크는 가장 오래된 것으로 본다. */
export function oldestProblem(problems: SeatMark[]): SeatMark | null {
  if (problems.length === 0) return null
  return problems.reduce((oldest, m) => (markTime(m) < markTime(oldest) ? m : oldest))
}

/** "3조"·"3팀"·"A-3팀" → 3 (조/팀 앞 숫자). 조/팀 없는 레거시(table_3 등)는 null — 좌석 키와의 오매칭을 막는다.
 *  좌석 키 규약이 "{테이블번호}-{좌석번호}"이고 LG 배치도는 "A-N팀"으로 라벨하므로 팀 표기를 반드시 지원해야 한다. */
export function tableNumberFromLabel(label: string): number | null {
  const m = label.match(/(\d+)\s*(?:조|팀)$/)
  return m ? parseInt(m[1], 10) : null
}

/** 조 라벨 기준 problem 좌석 수 — seat key 규약 "{조번호}-{좌석번호}" (lib/seatmap/layout.ts). */
export function countProblemSeatsForTable(marks: SeatMark[], label: string): number {
  const n = tableNumberFromLabel(label)
  if (n === null) return 0
  const prefix = `${n}-`
  return marks.reduce((c, m) => (m.status === 'problem' && m.seat_key.startsWith(prefix) ? c + 1 : c), 0)
}

/** practice 티켓 최소 형태 — /api/data/session 응답 practice 배열과 구조 호환. */
export type PracticeTicketLite = { table_label: string; status: string }

/** 완료 계열 status — 실제 enum: help_needed | assisting | solved | follow_up (lib/action/handlers/practice.ts). */
const TICKET_DONE_STATUSES: ReadonlySet<string> = new Set(['solved'])

/** 해당 조 라벨의 미해결 practice 티켓 수 (follow_up은 후속 조치 필요 = 미해결로 센다). */
export function countOpenTickets(tickets: PracticeTicketLite[] | undefined, tableLabel: string): number {
  if (!tickets) return 0
  return tickets.reduce(
    (c, t) => (t.table_label === tableLabel && !TICKET_DONE_STATUSES.has(t.status) ? c + 1 : c),
    0
  )
}

/** 사유별 집계 — count 내림차순, 사유 없는 마크는 '미지정'으로 묶는다. */
export function groupProblemCounts(problems: SeatMark[]): { label: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of problems) {
    const label = reasonLabel(m.reason) || '미지정'
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'))
}
