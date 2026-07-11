'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/primitives'
import { useFlashOnIncrease } from './board-hooks'
import {
  elapsedMinutes,
  findTableBySeat,
  groupProblemCounts,
  oldestProblem,
  problemChipLabel
} from './seat-utils'
import type { SeatLayoutConfig, SeatMark } from './types'

/** 이 건수를 초과하면 개별 칩 대신 사유별 집계 + 최장 경과 1건으로 접는다. */
const GROUP_THRESHOLD = 5

type StripProps = {
  layout: SeatLayoutConfig
  problems: SeatMark[]
  resolvedCount: number
  selectedKey: string | null
  onSelect: (seatKey: string) => void
  pulsing: boolean
  now: number
  large: boolean
  trailing: React.ReactNode
}

export function ProblemStrip(p: StripProps) {
  const [expanded, setExpanded] = useState(false)
  const grouped = p.problems.length > GROUP_THRESHOLD && !expanded
  return (
    <Card className={'px-3 py-2 md:px-4 md:py-3 transition-colors ' + (p.pulsing ? 'motion-safe:animate-pulse border-[#ef8080]' : '')}>
      <div className="flex items-center gap-2">
        <div
          className="flex-1 min-w-0 flex items-center gap-2 overflow-x-auto md:flex-wrap md:overflow-visible"
          role="status"
          aria-live="polite"
        >
          <span
            className={
              (p.large ? 'text-base ' : 'text-sm ') +
              'shrink-0 font-medium ' +
              (p.problems.length > 0 ? 'text-[#ef8080]' : 'text-textDim')
            }
          >
            문제 {p.problems.length}건
          </span>
          <ResolvedCounter count={p.resolvedCount} large={p.large} />
          <StripChips {...p} grouped={grouped} onExpand={() => setExpanded(true)} onCollapse={() => setExpanded(false)} />
        </div>
        {p.trailing ? <span className="shrink-0 md:hidden">{p.trailing}</span> : null}
      </div>
    </Card>
  )
}

function StripChips(p: StripProps & { grouped: boolean; onExpand: () => void; onCollapse: () => void }) {
  if (p.problems.length === 0) {
    return <span className="shrink-0 text-xs text-textMute">현재 문제로 표시된 좌석이 없습니다.</span>
  }
  if (p.grouped) return <GroupedChips {...p} />
  return (
    <>
      {p.problems.map((m) => (
        <ProblemChip
          key={m.seat_key}
          mark={m}
          layout={p.layout}
          selectedKey={p.selectedKey}
          onSelect={p.onSelect}
          now={p.now}
          large={p.large}
        />
      ))}
      {p.problems.length > GROUP_THRESHOLD ? (
        <StripActionButton testId="collapse-problems" label="접기" large={p.large} onClick={p.onCollapse} />
      ) : null}
    </>
  )
}

/** 폭주 모드 — 사유별 집계 칩 + 최장 경과 1건만 개별 강조 + 전체 보기. */
function GroupedChips(p: StripProps & { onExpand: () => void }) {
  const groups = groupProblemCounts(p.problems)
  const oldest = oldestProblem(p.problems)
  return (
    <>
      {groups.map((g) => (
        <span
          key={g.label}
          data-group-chip={g.label}
          className={
            (p.large ? 'px-3 py-1.5 text-sm ' : 'px-2.5 py-1 text-xs ') +
            'shrink-0 whitespace-nowrap rounded border bg-[#d64545]/10 border-[#d64545]/30 text-[#ef8080]'
          }
        >
          {g.label} {g.count}
        </span>
      ))}
      {oldest ? (
        <ProblemChip
          mark={oldest}
          layout={p.layout}
          selectedKey={p.selectedKey}
          onSelect={p.onSelect}
          now={p.now}
          large={p.large}
          emphasis
        />
      ) : null}
      <StripActionButton testId="expand-problems" label={`전체 보기 (${p.problems.length})`} large={p.large} onClick={p.onExpand} />
    </>
  )
}

function StripActionButton({ testId, label, large, onClick }: { testId: string; label: string; large: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-strip-action={testId}
      onClick={onClick}
      className={
        (large ? 'px-3 py-1.5 min-h-[44px] text-sm ' : 'px-2.5 py-1 min-h-[44px] text-xs ') +
        'shrink-0 min-w-[44px] whitespace-nowrap rounded border border-border bg-surfaceAlt text-textDim transition-colors hover:text-text hover:bg-border'
      }
    >
      {label}
    </button>
  )
}

/** 해결 보상 카운터 — 해결 마킹 순간 0.6초 강조 플래시(motion-safe). */
function ResolvedCounter({ count, large }: { count: number; large: boolean }) {
  const flash = useFlashOnIncrease(count)
  return (
    <span
      data-resolved-counter={count}
      data-flash={flash ? 'on' : 'off'}
      className={
        (large ? 'text-sm ' : 'text-xs ') +
        'shrink-0 whitespace-nowrap px-2 py-0.5 rounded border transition-colors ' +
        (flash
          ? 'motion-safe:animate-[pulse_0.6s_ease-in-out_1] bg-[#3f9d63]/30 border-[#3f9d63] text-[#7ccd9e] font-semibold'
          : 'bg-surfaceAlt border-border text-textDim')
      }
    >
      오늘 해결 {count}건
    </span>
  )
}

function ProblemChip({
  mark,
  layout,
  selectedKey,
  onSelect,
  now,
  large,
  emphasis = false
}: {
  mark: SeatMark
  layout: SeatLayoutConfig
  selectedKey: string | null
  onSelect: (seatKey: string) => void
  now: number
  large: boolean
  emphasis?: boolean
}) {
  const table = findTableBySeat(layout, mark.seat_key)
  const mins = elapsedMinutes(mark.updated_at, now)
  const stale = mins !== null && mins >= 5
  const active = selectedKey === mark.seat_key
  const tone = active
    ? 'bg-[#d64545]/25 border-[#d64545]/70 text-[#f0a0a0]'
    : stale || emphasis
      ? 'bg-[#d64545]/30 border-[#d64545] text-[#f0a0a0]'
      : 'bg-[#d64545]/10 border-[#d64545]/40 text-[#ef8080] hover:bg-[#d64545]/20'
  return (
    <button
      type="button"
      data-problem-chip={mark.seat_key}
      onClick={() => onSelect(mark.seat_key)}
      aria-pressed={active}
      className={
        (large ? 'px-4 py-2 min-h-[44px] text-sm ' : 'px-3 py-1.5 min-h-[44px] text-xs ') +
        'shrink-0 min-w-[44px] whitespace-nowrap rounded border transition-colors ' +
        tone +
        (emphasis ? ' ring-1 ring-[#ef8080]' : '')
      }
    >
      {problemChipLabel(table?.label ?? null, mark.seat_key, mark.reason, mins)}
    </button>
  )
}
