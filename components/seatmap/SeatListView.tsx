'use client'

import { useSessionData } from '@/lib/realtime/channel'
import { Badge, Card } from '@/components/ui/primitives'
import { countOpenTickets, seatAriaLabel, seatNumber } from './seat-utils'
import type { PracticeTicketLite } from './seat-utils'
import type { SeatLayoutConfig, SeatMark, SeatStatus, SeatTable } from './types'

type Props = {
  layout: SeatLayoutConfig
  marks: SeatMark[]
  selectedKey: string | null
  /** 5분 이상 미해결 problem 좌석 — 강조 링 표시. */
  staleKeys: ReadonlySet<string>
  /** 보드와 동일한 탭 핸들러 — 마킹 모드 탭=마킹/재탭=해제, 보기 모드 탭=패널. */
  onSeatTap: (seatKey: string) => void
}

/** 조별 목록 뷰 — 모바일에서 배치도 대신 44px+ 터치 타깃으로 마킹한다. */
export function SeatListView({ layout, marks, selectedKey, staleKeys, onSeatTap }: Props) {
  const markMap = new Map(marks.map((m) => [m.seat_key, m]))
  // 페이지 레벨 구독과 같은 SWR 키 — 추가 폴링 없이 practice 티켓 수를 dedupe로 얻는다.
  const { data } = useSessionData<{ practice?: PracticeTicketLite[] }>('/api/data/session')
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="조별 좌석 목록">
      {layout.tables.map((t) => (
        <GroupCard
          key={t.label}
          table={t}
          markMap={markMap}
          selectedKey={selectedKey}
          staleKeys={staleKeys}
          onSeatTap={onSeatTap}
          openTickets={countOpenTickets(data?.practice, t.label)}
        />
      ))}
    </div>
  )
}

function GroupCard({
  table,
  markMap,
  selectedKey,
  staleKeys,
  onSeatTap,
  openTickets
}: {
  table: SeatTable
  markMap: Map<string, SeatMark>
  selectedKey: string | null
  staleKeys: ReadonlySet<string>
  onSeatTap: (seatKey: string) => void
  /** 같은 조 라벨의 미해결 practice 티켓 수 — 1건 이상일 때만 배지 표시. */
  openTickets: number
}) {
  const problems = table.seats.filter((s) => markMap.get(s.key)?.status === 'problem').length
  const rosterCount = table.roster?.length ?? 0
  return (
    <Card className={problems > 0 ? 'border-l-4 border-l-[#d64545]' : ''}>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="text-sm font-medium text-text">{table.label}</span>
        {rosterCount > 0 ? <span className="text-xs text-textMute">{rosterCount}명</span> : null}
        {openTickets > 0 ? <Badge tone="info">티켓 {openTickets}</Badge> : null}
        {problems > 0 ? (
          <span className="ml-auto text-xs font-medium text-[#ef8080]">문제 {problems}</span>
        ) : null}
      </div>
      <div className="px-3 py-2.5 flex flex-wrap gap-2">
        {table.seats.map((s) => (
          <SeatButton
            key={s.key}
            seatKey={s.key}
            tableLabel={table.label}
            mark={markMap.get(s.key) ?? null}
            selected={selectedKey === s.key}
            stale={staleKeys.has(s.key)}
            onSeatTap={onSeatTap}
          />
        ))}
      </div>
    </Card>
  )
}

const SEAT_TONE: Record<SeatStatus, string> = {
  none: 'bg-surfaceAlt border-[#3A3A41] text-textDim',
  problem: 'bg-[#d64545] border-[#ef8080] text-white',
  resolved: 'bg-[#3f9d63] border-[#7ccd9e] text-white'
}

function SeatButton({
  seatKey,
  tableLabel,
  mark,
  selected,
  stale,
  onSeatTap
}: {
  seatKey: string
  tableLabel: string
  mark: SeatMark | null
  selected: boolean
  stale: boolean
  onSeatTap: (seatKey: string) => void
}) {
  const status: SeatStatus = mark?.status ?? 'none'
  const ariaBase = seatAriaLabel(tableLabel, seatKey, status)
  return (
    <button
      type="button"
      data-seat-list-button={seatKey}
      aria-pressed={selected}
      aria-label={stale ? `${ariaBase}, 5분 이상 경과` : ariaBase}
      onClick={() => onSeatTap(seatKey)}
      className={
        'relative flex-1 min-w-[44px] max-w-[64px] h-12 rounded border text-sm font-semibold transition-colors ' +
        SEAT_TONE[status] +
        (selected ? ' ring-2 ring-[#E8E8EA] ring-offset-1 ring-offset-bg' : '') +
        (stale ? ' shadow-[0_0_0_2px_#ef8080]' : '')
      }
    >
      {seatNumber(seatKey)}
      {status !== 'none' ? <ListStatusGlyph status={status} /> : null}
    </button>
  )
}

/** 색약 대비용 형태 부호화 — 배치도 글리프와 동일 의미(problem=느낌표, resolved=체크). */
function ListStatusGlyph({ status }: { status: 'problem' | 'resolved' }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className="absolute -top-1.5 -right-1.5 w-4 h-4">
      <circle
        cx={5}
        cy={5}
        r={4.4}
        fill="#E8E8EA"
        stroke={status === 'problem' ? '#d64545' : '#3f9d63'}
        strokeWidth={0.8}
      />
      {status === 'problem' ? (
        <>
          <path d="M 5 2.3 L 5 5.5" stroke="#b22f2f" strokeWidth={1.4} strokeLinecap="round" fill="none" />
          <circle cx={5} cy={7.3} r={0.85} fill="#b22f2f" />
        </>
      ) : (
        <path
          d="M 2.7 5.2 L 4.4 6.9 L 7.4 3.4"
          stroke="#2c7a4b"
          strokeWidth={1.3}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  )
}
