// Lecture LiveOps — Generic AI교육 좌석 레이아웃 빌더 (38명/8조)
// 좌표는 0~100 viewBox 단위. seed 스크립트와 fixture가 동일 구조를 사용한다.
// 주의: scripts/seed-seatmap.mjs 가 node type-stripping 으로 직접 import 하므로
//       이 파일은 erasable TS(type-only import)만 사용한다.

import type { SeatLayoutConfig } from '../db/schema'

const TABLE_XS = [14, 38, 62, 86]
// T자(⊥, 거꾸로 T) 테이블: 세로 stem(위) + 가로 bar(아래). 좌석은 2·2·2 패턴 —
// stem 좌·우에 2명씩 마주보기, bar 바깥(아래)에 2명. 5인조는 bar 1석, 4인조는 stem만.
const BAR_W = 15
const BAR_H = 5.5
const STEM_W = 5.5
const STEM_H = 10
const STEM_SIDE = STEM_W / 2 + 3.8 // stem 옆 좌석 가로 오프셋
const BAR_BELOW = STEM_H / 2 + BAR_H + 3.6 // bar 아래 좌석 세로 오프셋 (cy 기준)

// 번호: 1·2 = stem 왼쪽(위→아래), 3·4 = stem 오른쪽, 5·6 = bar 아래(왼→오) — 조당 6명
const SIX_SEAT_OFFSETS = [
  { ox: -STEM_SIDE, oy: -5.6 },
  { ox: -STEM_SIDE, oy: 1.4 },
  { ox: STEM_SIDE, oy: -5.6 },
  { ox: STEM_SIDE, oy: 1.4 },
  { ox: -4.3, oy: BAR_BELOW },
  { ox: 4.3, oy: BAR_BELOW }
]

// 교육장 5석 T자 배치: bar(가로 ―) 2석 + stem 화면 왼쪽 2석 + 오른쪽 1석.
// 번호: 1·2 = stem 왼쪽(위→아래), 3 = stem 오른쪽(중앙), 4·5 = bar 아래(왼→오).
export const TSHAPE_5_BAR2_LEFT2_RIGHT1: ReadonlyArray<{ ox: number; oy: number }> = [
  { ox: -STEM_SIDE, oy: -5.6 },
  { ox: -STEM_SIDE, oy: 1.4 },
  { ox: STEM_SIDE, oy: -2.1 },
  { ox: -4.3, oy: BAR_BELOW },
  { ox: 4.3, oy: BAR_BELOW }
]

export type SeatRoster = Record<string, string[]>

// roster: { "1조": ["..."], ... } — 없으면 roster 필드 생략
export function buildEightTeamSeatLayout(roster?: SeatRoster): SeatLayoutConfig {
  const tables = Array.from({ length: 8 }, (_, idx) => {
    const n = idx + 1
    const label = `${n}조`
    const cy = n <= 4 ? 33 : 66 // 상단행 1~4조 / 하단행 5~8조
    const cx = TABLE_XS[idx % 4]
    const offsets = SIX_SEAT_OFFSETS
    const names = roster?.[label]
    return {
      label,
      kind: 'tshape' as const,
      cx,
      cy,
      w: BAR_W,
      h: BAR_H,
      stemW: STEM_W,
      stemH: STEM_H,
      seats: offsets.map((o, i) => ({ key: `${n}-${i + 1}`, ox: o.ox, oy: o.oy })),
      ...(names && names.length > 0 ? { roster: [...names] } : {})
    }
  })
  return {
    zones: [
      { id: 'screen', label: '스크린', kind: 'screen' as const, x: 35, y: 2, w: 30, h: 6 },
      { id: 'desk', label: '강사석', kind: 'desk' as const, x: 42, y: 10, w: 16, h: 5 }
    ],
    tables
  }
}

// 임의 팀 수 × 좌석 수의 T자 레이아웃 (교육장 5팀×5석 앞3·뒤2 등 교육별 재사용).
// seatsPerTeam이 5면 stem 좌2·우2 + bar 1석, 6이면 bar 2석. perRow로 행 배치(예: perRow=3 → 앞3·뒤2).
// extraZones로 운영·퍼실리테이터용 일자(직선) 테이블 등 비좌석 영역을 추가한다.
export function buildTshapeLayout(opts: {
  teams: number
  seatsPerTeam: number
  perRow?: number
  labelFn?: (n: number) => string
  roster?: SeatRoster
  extraZones?: SeatLayoutConfig['zones']
  seatOffsets?: ReadonlyArray<{ ox: number; oy: number }>
  rowYs?: ReadonlyArray<number>
}): SeatLayoutConfig {
  const teams = Math.max(1, opts.teams)
  const seatsPerTeam = Math.min(6, Math.max(1, opts.seatsPerTeam))
  const perRow = Math.max(1, opts.perRow ?? Math.min(teams, 4))
  const labelFn = opts.labelFn ?? ((n: number) => `${n}팀`)
  const offsets = opts.seatOffsets ?? SIX_SEAT_OFFSETS.slice(0, seatsPerTeam)
  const rows = Math.ceil(teams / perRow)
  const tables = Array.from({ length: teams }, (_, idx) => {
    const n = idx + 1
    const label = labelFn(n)
    const row = Math.floor(idx / perRow)
    const col = idx % perRow
    const colsInRow = row === rows - 1 ? teams - row * perRow : perRow
    const cx = ((col + 1) / (colsInRow + 1)) * 100
    const cy = opts.rowYs && opts.rowYs[row] !== undefined
      ? opts.rowYs[row]
      : rows === 1
      ? 48
      : 30 + (row * 40) / Math.max(1, rows - 1)
    const names = opts.roster?.[label]
    return {
      label,
      kind: 'tshape' as const,
      cx,
      cy,
      w: BAR_W,
      h: BAR_H,
      stemW: STEM_W,
      stemH: STEM_H,
      seats: offsets.map((o, i) => ({ key: `${n}-${i + 1}`, ox: o.ox, oy: o.oy })),
      ...(names && names.length > 0 ? { roster: [...names] } : {})
    }
  })
  return {
    zones: [
      { id: 'screen', label: '스크린', kind: 'screen' as const, x: 35, y: 2, w: 30, h: 6 },
      { id: 'desk', label: '강사석', kind: 'desk' as const, x: 42, y: 10, w: 16, h: 5 },
      ...(opts.extraZones ?? [])
    ],
    tables
  }
}

export const LECTURE_T8_ROW_YS = [26, 54, 82] as const

export function buildLectureT8SeatLayout(roster?: SeatRoster): SeatLayoutConfig {
  return buildTshapeLayout({
    teams: 8,
    seatsPerTeam: 6,
    perRow: 3,
    labelFn: (n) => `${n}팀`,
    roster,
    rowYs: LECTURE_T8_ROW_YS
  })
}

// ── 반원(호) 배치 ───────────────────────────────────────────────────
// 강의실이 반원/호를 그리는 형태. 강사·화면을 위에 두고, 좌석은 그 아래에서
// 강사를 감싸도록 안으로 굽은 동심 ∪ 호(arc)에 펼친다(강사 입장에서 오목).
// 초점 F=(50,FY)를 화면 위(작은/음수 y)에 두면 각 행이 강사 쪽으로 오목해진다.
// 행마다 좌/중/우 3개의 호 테이블을 둔다(테이블은 좌석보다 화면 쪽=초점 쪽).
// 행 인덱스 0 = 맨 앞(강사에 가장 가까움, 가장 작은 반지름), 뒤로 갈수록 반지름이 는다.
export type ArcRowSpec = { left: number; center: number; right: number }

// 정본 스펙: 좌 [4,4,4,2] / 중 [5,6,7,8] / 우 [4,4,4,2] = 12 테이블 54석.
export const EXECUTIVE_ARC_ROWS: ReadonlyArray<ArcRowSpec> = [
  { left: 4, center: 5, right: 4 },
  { left: 4, center: 6, right: 4 },
  { left: 4, center: 7, right: 4 },
  { left: 2, center: 8, right: 2 }
]

export function buildArcLayout(opts: {
  rows: ReadonlyArray<ArcRowSpec>
  focalY?: number
  radii?: number[]
  halfWidths?: number[] // 행별 좌우 최대 반폭 (중앙 50 기준)
  seatTableGap?: number // 좌석~테이블 반지름 간격
  labelFn?: (n: number) => string
  roster?: SeatRoster
  extraZones?: SeatLayoutConfig['zones']
}): SeatLayoutConfig {
  const rows = opts.rows
  const n = rows.length
  const FY = opts.focalY ?? -70
  const radii = opts.radii ?? Array.from({ length: n }, (_, i) => 100 + i * 22)
  const halfWidths = opts.halfWidths ?? [43, 44, 46, 41]
  const gap = opts.seatTableGap ?? 4.2
  const labelFn = opts.labelFn ?? ((k) => `${k}조`)
  const r2 = (v: number) => Math.round(v * 100) / 100

  let tableNum = 0
  const tables = rows.flatMap((row, ri) => {
    const R = radii[ri] ?? 100 + ri * 22
    const total = row.left + row.center + row.right
    const half = Math.min(halfWidths[ri] ?? 44, R - 1)
    const theta = Math.asin(Math.min(0.985, half / R)) // 반각(rad)
    const seatAngle = (k: number) => -theta + ((k + 0.5) / total) * 2 * theta
    let k = 0
    return [row.left, row.center, row.right].map((cnt) => {
      tableNum++
      const angles = Array.from({ length: cnt }, () => seatAngle(k++))
      const mean = angles.reduce((a, b) => a + b, 0) / angles.length
      // 테이블은 좌석보다 초점(화면) 쪽 = 반지름 -gap. ∪ 이므로 y = FY + R·cosθ.
      const tcx = 50 + (R - gap) * Math.sin(mean)
      const tcy = FY + (R - gap) * Math.cos(mean)
      const label = labelFn(tableNum)
      const names = opts.roster?.[label]
      const seats = angles.map((a, i) => ({
        key: `${tableNum}-${i + 1}`,
        ox: r2(50 + R * Math.sin(a) - tcx),
        oy: r2(FY + R * Math.cos(a) - tcy)
      }))
      const span = cnt > 1 ? Math.abs((angles[cnt - 1] - angles[0]) * R) : 0
      return {
        label,
        kind: 'rect' as const,
        cx: r2(tcx),
        cy: r2(tcy),
        w: r2(Math.min(Math.max(7, span + 5.5), 24)),
        h: 3.2,
        seats,
        ...(names && names.length > 0 ? { roster: [...names] } : {})
      }
    })
  })

  return {
    zones: [
      { id: 'screen', label: '스크린', kind: 'screen' as const, x: 35, y: 2, w: 30, h: 6 },
      { id: 'desk', label: '강사석', kind: 'desk' as const, x: 42, y: 10, w: 16, h: 5 },
      ...(opts.extraZones ?? [])
    ],
    tables
  }
}
