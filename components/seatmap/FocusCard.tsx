'use client'

import { Card } from '@/components/ui/primitives'
import { STATUS_LABEL, elapsedMinutes, findTableBySeat, oldestProblem, reasonLabel, seatNumber } from './seat-utils'
import type { SeatLayoutConfig, SeatMark, SeatStatus } from './types'

type Props = {
  layout: SeatLayoutConfig
  problems: SeatMark[]
  marks: SeatMark[]
  /** 강사가 보드에서 직접 탭한 좌석 — 있으면 최장 경과 대신 이 좌석을 포커스한다. */
  selectedKey: string | null
  now: number
  saving: boolean
  onSelect: (seatKey: string) => void
  onResolve: (seatKey: string) => void
}

type FocusTarget = { seatKey: string; mark: SeatMark | null; picked: boolean }

/** 강사 뷰 단일 포커스 — 탭한 좌석 우선, 없으면 최장 경과 문제 1건.
 *  문제 0건 + 선택 없음이면 안심 신호를 유지한다. */
export function FocusCard(p: Props) {
  const target = resolveFocusTarget(p)
  if (!target) return <AllClearCard />
  const problem = target.mark?.status === 'problem'
  return (
    <Card className={problem ? 'border-[#d64545]/60' : 'border-border'}>
      <div
        data-focus-card
        data-focus-state={problem ? 'problem' : 'selected'}
        data-focus-seat={target.seatKey}
        className="flex items-center gap-2 pr-3 md:pr-4"
      >
        <FocusSummary target={target} layout={p.layout} now={p.now} onSelect={p.onSelect} />
        <ResolveButton seatKey={target.seatKey} saving={p.saving} onResolve={p.onResolve} />
      </div>
    </Card>
  )
}

function resolveFocusTarget(p: Props): FocusTarget | null {
  if (p.selectedKey) {
    const mark = p.marks.find((m) => m.seat_key === p.selectedKey) ?? null
    return { seatKey: p.selectedKey, mark, picked: true }
  }
  const oldest = oldestProblem(p.problems)
  return oldest ? { seatKey: oldest.seat_key, mark: oldest, picked: false } : null
}

function FocusSummary({
  target,
  layout,
  now,
  onSelect
}: {
  target: FocusTarget
  layout: SeatLayoutConfig
  now: number
  onSelect: (seatKey: string) => void
}) {
  const table = findTableBySeat(layout, target.seatKey)
  const seatLabel = table ? `${table.label}-${seatNumber(target.seatKey)}` : seatNumber(target.seatKey)
  const status: SeatStatus = target.mark?.status ?? 'none'
  const problem = status === 'problem'
  const mins = problem ? elapsedMinutes(target.mark?.updated_at, now) : null
  const reason = problem ? reasonLabel(target.mark?.reason) : ''
  return (
    <button
      type="button"
      data-focus-summary
      onClick={() => onSelect(target.seatKey)}
      className="flex-1 min-w-0 px-4 py-4 md:px-6 md:py-5 text-left rounded-l-md transition-colors hover:bg-surfaceAlt"
    >
      <p className="text-xs text-textMute">
        {target.picked ? '선택한 자리' : '지금 볼 것 — 가장 오래 기다린 자리'}
      </p>
      <p className={'mt-1 text-2xl md:text-3xl font-semibold ' + summaryTone(status)}>
        {seatLabel}
        {!problem ? <span className="ml-3 text-lg md:text-xl text-textDim">{STATUS_LABEL[status]}</span> : null}
        {reason ? <span className="ml-3 text-lg md:text-xl text-[#ef8080]">{reason}</span> : null}
        {mins !== null ? <span className="ml-3 text-lg md:text-xl text-textDim">{mins}분 경과</span> : null}
      </p>
      {target.mark?.memo ? <p className="mt-1 text-sm text-textDim truncate">{target.mark.memo}</p> : null}
    </button>
  )
}

function summaryTone(status: SeatStatus): string {
  if (status === 'problem') return 'text-[#f0a0a0]'
  if (status === 'resolved') return 'text-[#7ccd9e]'
  return 'text-text'
}

/** 즉석 해결 — 포커스 좌석을 1탭으로 resolved 마킹한다. */
function ResolveButton({
  seatKey,
  saving,
  onResolve
}: {
  seatKey: string
  saving: boolean
  onResolve: (seatKey: string) => void
}) {
  return (
    <button
      type="button"
      data-focus-resolve
      disabled={saving}
      onClick={() => onResolve(seatKey)}
      className={
        'shrink-0 min-w-[44px] min-h-[44px] px-4 rounded border text-sm font-medium transition-colors ' +
        'disabled:opacity-40 disabled:cursor-not-allowed ' +
        'bg-[#3f9d63]/15 border-[#3f9d63]/60 text-[#7ccd9e] hover:bg-[#3f9d63]/25'
      }
    >
      해결 처리
    </button>
  )
}

function AllClearCard() {
  return (
    <Card className="border-[#3f9d63]/50">
      <div data-focus-card data-focus-state="clear" className="px-4 py-4 md:px-6 md:py-5">
        <p className="text-xs text-textMute">지금 볼 것</p>
        <p className="mt-1 text-xl md:text-2xl font-semibold text-[#7ccd9e]">모든 자리 정상 — 진행하세요</p>
      </div>
    </Card>
  )
}
