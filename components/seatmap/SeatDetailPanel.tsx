'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useSessionData } from '@/lib/realtime/channel'
import { Button, Card, CardHeader, Textarea } from '@/components/ui/primitives'
import { ReasonChips } from './ReasonChips'
import { STATUS_LABEL, countOpenTickets, reasonLabel, seatNumber } from './seat-utils'
import type { PracticeTicketLite } from './seat-utils'
import type { SeatMark, SeatStatus, SeatTable } from './types'

type Props = {
  seatKey: string | null
  table: SeatTable | null
  mark: SeatMark | null
  saving: boolean
  onSetStatus: (status: SeatStatus) => void
  onSetReason: (reason: string | null) => void
  onSaveMemo: (memo: string) => void
}

export function SeatDetailPanel({ seatKey, table, mark, saving, onSetStatus, onSetReason, onSaveMemo }: Props) {
  if (!seatKey) {
    return (
      <Card>
        <CardHeader title="좌석 상세" />
        <div className="p-4 text-sm text-textDim">
          배치도에서 좌석을 선택하면 상태를 변경할 수 있습니다.
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title={seatDetailTitle(table, seatKey)} hint={seatKey} />
      <SeatDetailBody
        idPrefix="panel"
        seatKey={seatKey}
        table={table}
        mark={mark}
        saving={saving}
        onSetStatus={onSetStatus}
        onSetReason={onSetReason}
        onSaveMemo={onSaveMemo}
      />
    </Card>
  )
}

export function seatDetailTitle(table: SeatTable | null, seatKey: string): string {
  return `${table ? table.label + ' ' : ''}${seatNumber(seatKey)}번 자리`
}

type BodyProps = Omit<Props, 'seatKey'> & {
  seatKey: string
  /** DOM id 접두사 — 데스크톱 패널/모바일 시트 동시 렌더 시 id 충돌 방지. */
  idPrefix: string
}

/** 상태 3버튼/사유 칩/메모/명단 — 데스크톱 카드와 모바일 바텀시트가 공유한다. */
export function SeatDetailBody({ idPrefix, seatKey, table, mark, saving, onSetStatus, onSetReason, onSaveMemo }: BodyProps) {
  const [memo, setMemo] = useState('')
  const [memoSeat, setMemoSeat] = useState<string | null>(null)
  if (seatKey !== memoSeat) {
    setMemoSeat(seatKey)
    setMemo(mark?.memo ?? '')
  }

  const status: SeatStatus = mark?.status ?? 'none'
  return (
    <div className="p-4 flex flex-col gap-4">
      <StatusLine status={status} mark={mark} />
      <PracticeTicketNotice tableLabel={table?.label ?? null} />
      <StatusButtons status={status} saving={saving} onSetStatus={onSetStatus} />
      <div>
        <div className="text-xs text-textMute mb-1">사유</div>
        <ReasonChips current={mark?.reason || null} disabled={saving} onSelect={onSetReason} />
      </div>
      <MemoEditor memoId={`${idPrefix}-seat-memo`} memo={memo} saving={saving} onChange={setMemo} onSave={() => onSaveMemo(memo)} />
      <RosterList table={table} />
    </div>
  )
}

/** 같은 조의 미해결 practice 티켓 안내 — 좌석 보드에서 실습 상황을 함께 본다.
 *  /api/data/session은 페이지 레벨 구독과 같은 SWR 키라 추가 요청 없이 dedupe된다. */
function PracticeTicketNotice({ tableLabel }: { tableLabel: string | null }) {
  const { data } = useSessionData<{ practice?: PracticeTicketLite[] }>('/api/data/session')
  const count = tableLabel ? countOpenTickets(data?.practice, tableLabel) : 0
  if (count === 0) return null
  return (
    <Link
      href="/today/practice"
      data-practice-ticket-notice=""
      className="flex items-center min-h-[44px] px-2.5 rounded border border-info/30 bg-info/10 text-xs text-info transition-colors hover:bg-info/20"
    >
      이 조 실습 티켓 {count}건 — 실습 지원 탭 참고
    </Link>
  )
}

function StatusLine({ status, mark }: { status: SeatStatus; mark: SeatMark | null }) {
  const tone =
    status === 'problem' ? 'text-[#ef8080]' : status === 'resolved' ? 'text-[#7ccd9e]' : 'text-textDim'
  return (
    <div role="status" aria-live="polite" className="text-sm">
      <span className="text-textMute">현재 상태</span>{' '}
      <span className={`font-medium ${tone}`}>{STATUS_LABEL[status]}</span>
      {mark?.reason ? <span className="text-xs text-textDim ml-1.5">{reasonLabel(mark.reason)}</span> : null}
      {mark?.updated_at ? (
        <span className="text-xs text-textMute ml-2">
          {formatTime(mark.updated_at)}
          {mark.updated_by ? ` · ${mark.updated_by}` : ''}
        </span>
      ) : null}
    </div>
  )
}

function StatusButtons({
  status,
  saving,
  onSetStatus
}: {
  status: SeatStatus
  saving: boolean
  onSetStatus: (status: SeatStatus) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <StatusButton
        label="문제"
        active={status === 'problem'}
        activeClass="bg-[#d64545]/20 border-[#d64545]/60 text-[#ef8080]"
        disabled={saving}
        onClick={() => onSetStatus('problem')}
      />
      <StatusButton
        label="해결"
        active={status === 'resolved'}
        activeClass="bg-[#3f9d63]/20 border-[#3f9d63]/60 text-[#7ccd9e]"
        disabled={saving}
        onClick={() => onSetStatus('resolved')}
      />
      <StatusButton
        label="초기화"
        active={status === 'none'}
        activeClass="bg-surfaceAlt border-textMute text-text"
        disabled={saving}
        onClick={() => onSetStatus('none')}
      />
    </div>
  )
}

function StatusButton({
  label,
  active,
  activeClass,
  disabled,
  onClick
}: {
  label: string
  active: boolean
  activeClass: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={
        'min-h-[44px] px-3 rounded border text-sm font-medium transition-colors ' +
        'disabled:opacity-40 disabled:cursor-not-allowed ' +
        (active ? activeClass : 'bg-surfaceAlt border-border text-textDim hover:text-text hover:bg-border')
      }
    >
      {label}
    </button>
  )
}

function MemoEditor({
  memoId,
  memo,
  saving,
  onChange,
  onSave
}: {
  memoId: string
  memo: string
  saving: boolean
  onChange: (v: string) => void
  onSave: () => void
}) {
  return (
    <div>
      <label htmlFor={memoId} className="block text-xs text-textMute mb-1">
        메모
      </label>
      <Textarea
        id={memoId}
        rows={3}
        value={memo}
        onChange={(e) => onChange(e.target.value)}
        placeholder="증상, 조치 내용 등"
      />
      <Button className="mt-2 w-full min-h-[44px]" onClick={onSave} disabled={saving}>
        메모 저장
      </Button>
    </div>
  )
}

function RosterList({ table }: { table: SeatTable | null }) {
  if (!table?.roster || table.roster.length === 0) return null
  return (
    <div>
      <div className="text-xs text-textMute mb-1">{table.label} 명단</div>
      <ul className="flex flex-wrap gap-1.5">
        {table.roster.map((name) => (
          <li
            key={name}
            className="px-2 py-1 text-xs rounded border border-border bg-surfaceAlt text-textDim"
          >
            {name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}
