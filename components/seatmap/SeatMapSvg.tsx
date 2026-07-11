'use client'

import { seatAriaLabel, seatNumber } from './seat-utils'
import type { SeatDef, SeatLayoutConfig, SeatMark, SeatStatus, SeatTable, SeatZone } from './types'

const SEAT_R = 3

const TOKEN = {
  surface: '#141416',
  surfaceAlt: '#1B1B1F',
  border: '#26262B',
  borderSoft: '#3A3A41',
  textDim: '#9A9AA1',
  textMute: '#6A6A72',
  accent: '#76B900'
}

const STATUS_STYLE: Record<SeatStatus, { fill: string; stroke: string; label: string }> = {
  none: { fill: TOKEN.surfaceAlt, stroke: TOKEN.borderSoft, label: TOKEN.textDim },
  problem: { fill: '#d64545', stroke: '#ef8080', label: '#FFFFFF' },
  resolved: { fill: '#3f9d63', stroke: '#7ccd9e', label: '#FFFFFF' }
}

type Props = {
  layout: SeatLayoutConfig
  marks: SeatMark[]
  selectedKey: string | null
  onSelect: (seatKey: string) => void
  /** 5분 이상 미해결 problem 좌석 — 테두리를 굵게 표시한다. */
  staleKeys?: ReadonlySet<string>
  /** 강사 컴팩트 뷰 — 좌석 원·텍스트 확대. */
  large?: boolean
}

export function SeatMapSvg({ layout, marks, selectedKey, onSelect, staleKeys, large = false }: Props) {
  const markMap = new Map(marks.map((m) => [m.seat_key, m]))
  const maxY = computeMaxY(layout)
  const scale = large ? 1.3 : 1
  return (
    <svg
      viewBox={`0 0 100 ${maxY}`}
      className="w-full h-auto block select-none"
      role="group"
      aria-label="좌석 배치도"
      preserveAspectRatio="xMidYMid meet"
    >
      {layout.zones.map((z) => (
        <ZoneShape key={z.id} zone={z} />
      ))}
      {layout.tables.map((t) => (
        <TableGroup
          key={t.label}
          table={t}
          markMap={markMap}
          selectedKey={selectedKey}
          onSelect={onSelect}
          staleKeys={staleKeys}
          scale={scale}
        />
      ))}
    </svg>
  )
}

/** T자(⊥) 테이블 — 세로 stem(위) + 가로 bar(아래). cy는 stem 영역 중심. */
function TShapeBody({ table }: { table: SeatTable }) {
  const stemW = table.stemW ?? 5
  const stemH = table.stemH ?? 10
  const barW = table.w ?? 14
  const barH = table.h ?? 5
  const stemTop = table.cy - stemH / 2
  return (
    <g>
      <rect
        x={table.cx - stemW / 2}
        y={stemTop}
        width={stemW}
        height={stemH}
        rx={0.8}
        fill={TOKEN.surface}
        stroke={TOKEN.border}
        strokeWidth={0.35}
      />
      <rect
        x={table.cx - barW / 2}
        y={stemTop + stemH}
        width={barW}
        height={barH}
        rx={0.8}
        fill={TOKEN.surface}
        stroke={TOKEN.border}
        strokeWidth={0.35}
      />
    </g>
  )
}

function tableExtentY(t: SeatTable): number {
  const body =
    t.kind === 'tshape'
      ? (t.stemH ?? 10) / 2 + (t.h ?? 5)
      : t.kind === 'rect'
        ? (t.h ?? 0) / 2
        : (t.r ?? 0)
  const seatReach = Math.max(body, ...t.seats.map((s) => Math.abs(s.oy ?? 0)))
  return t.cy + seatReach + SEAT_R * 2
}

function computeMaxY(layout: SeatLayoutConfig): number {
  const ys = [...layout.zones.map((z) => z.y + z.h), ...layout.tables.map(tableExtentY)]
  const max = ys.length > 0 ? Math.max(...ys) : 86
  return Math.min(Math.max(Math.ceil(max + 3), 50), 120)
}

function seatPosition(t: SeatTable, s: SeatDef): { x: number; y: number } {
  if (t.kind === 'rect' || s.angleDeg === undefined) {
    return { x: t.cx + (s.ox ?? 0), y: t.cy + (s.oy ?? 0) }
  }
  const rad = (s.angleDeg * Math.PI) / 180
  return { x: t.cx + (t.r ?? 0) * Math.cos(rad), y: t.cy + (t.r ?? 0) * Math.sin(rad) }
}

function ZoneShape({ zone }: { zone: SeatZone }) {
  const isScreen = zone.kind === 'screen'
  return (
    <g aria-hidden="true">
      <rect
        x={zone.x}
        y={zone.y}
        width={zone.w}
        height={zone.h}
        rx={0.8}
        fill={isScreen ? TOKEN.surfaceAlt : TOKEN.surface}
        stroke={TOKEN.border}
        strokeWidth={0.3}
      />
      <text
        x={zone.x + zone.w / 2}
        y={zone.y + zone.h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.4}
        letterSpacing={isScreen ? 0.6 : 0.1}
        fill={TOKEN.textMute}
      >
        {zone.label}
      </text>
    </g>
  )
}

function TableGroup({
  table,
  markMap,
  selectedKey,
  onSelect,
  staleKeys,
  scale
}: {
  table: SeatTable
  markMap: Map<string, SeatMark>
  selectedKey: string | null
  onSelect: (seatKey: string) => void
  staleKeys?: ReadonlySet<string>
  scale: number
}) {
  return (
    <g>
      {table.kind === 'tshape' ? (
        <TShapeBody table={table} />
      ) : table.kind === 'rect' ? (
        <rect
          x={table.cx - (table.w ?? 0) / 2}
          y={table.cy - (table.h ?? 0) / 2}
          width={table.w ?? 0}
          height={table.h ?? 0}
          rx={0.8}
          fill={TOKEN.surface}
          stroke={TOKEN.border}
          strokeWidth={0.35}
        />
      ) : (
        <circle
          cx={table.cx}
          cy={table.cy}
          r={table.r ?? 0}
          fill={TOKEN.surface}
          stroke={TOKEN.border}
          strokeWidth={0.35}
        />
      )}
      <text
        x={table.cx}
        y={table.kind === 'tshape' ? table.cy + (table.stemH ?? 10) / 2 + (table.h ?? 5) / 2 : table.cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={3 * scale}
        fontWeight={600}
        fill={TOKEN.textDim}
      >
        {table.label}
      </text>
      {table.seats.map((s) => {
        const { x, y } = seatPosition(table, s)
        return (
          <SeatNode
            key={s.key}
            x={x}
            y={y}
            seatKey={s.key}
            tableLabel={table.label}
            status={markMap.get(s.key)?.status ?? 'none'}
            selected={selectedKey === s.key}
            stale={staleKeys?.has(s.key) ?? false}
            scale={scale}
            onSelect={onSelect}
          />
        )
      })}
    </g>
  )
}

function SeatNode({
  x,
  y,
  seatKey,
  tableLabel,
  status,
  selected,
  stale,
  scale,
  onSelect
}: {
  x: number
  y: number
  seatKey: string
  tableLabel: string
  status: SeatStatus
  selected: boolean
  stale: boolean
  scale: number
  onSelect: (seatKey: string) => void
}) {
  const c = STATUS_STYLE[status]
  const r = SEAT_R * scale
  const ariaBase = seatAriaLabel(tableLabel, seatKey, status)
  return (
    <g
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={stale ? `${ariaBase}, 5분 이상 경과` : ariaBase}
      aria-pressed={selected}
      className="cursor-pointer"
      onClick={() => onSelect(seatKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(seatKey)
        }
      }}
    >
      <circle r={r + 1.4} fill="transparent" />
      {selected ? <circle r={r + 1.1} fill="none" stroke="#E8E8EA" strokeWidth={0.5} strokeDasharray="0.9 0.5" /> : null}
      <circle r={r} fill={c.fill} stroke={c.stroke} strokeWidth={stale ? 0.9 : 0.35} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={2.6 * scale}
        fontWeight={600}
        fill={c.label}
      >
        {seatNumber(seatKey)}
      </text>
      {status !== 'none' ? <StatusGlyph status={status} r={r} scale={scale} /> : null}
    </g>
  )
}

/** 색약 대비용 형태 부호화 — problem=느낌표, resolved=체크. */
function StatusGlyph({ status, r, scale }: { status: 'problem' | 'resolved'; r: number; scale: number }) {
  return (
    <g transform={`translate(${r * 0.78} ${-r * 0.78}) scale(${scale})`} aria-hidden="true">
      <circle r={1.5} fill="#E8E8EA" stroke={status === 'problem' ? '#d64545' : '#3f9d63'} strokeWidth={0.25} />
      {status === 'problem' ? (
        <>
          <path d="M 0 -0.75 L 0 0.2" stroke="#b22f2f" strokeWidth={0.45} strokeLinecap="round" fill="none" />
          <circle cy={0.72} r={0.26} fill="#b22f2f" />
        </>
      ) : (
        <path
          d="M -0.7 0.05 L -0.15 0.6 L 0.72 -0.5"
          stroke="#2c7a4b"
          strokeWidth={0.42}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </g>
  )
}
