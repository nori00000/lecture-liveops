'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, Badge, Button, Input, PageHeader, Select } from '@/components/ui/primitives'
import { countProblemSeatsForTable } from '@/components/seatmap/seat-utils'
import type { SeatmapResponse } from '@/components/seatmap/types'

type Ticket = { id: string; table_label: string; body: string; status: string; severity: string }

/** select 전용 sentinel — 실제 조 라벨과 충돌하지 않는 값. */
const CUSTOM_TABLE = '__custom__'

export default function PracticePage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; practice?: Ticket[] }>('/api/data/session')
  const session = data?.session
  const tickets = data?.practice ?? []
  // 좌석 보드와 같은 SWR 키 → 컴포넌트 간 dedupe. 키 ''(falsy)는 세션 확정 전 폴링을 막는다.
  const seatmapKey = session ? `/api/data/seatmap?sessionId=${encodeURIComponent(session.id)}` : ''
  const { data: seatmap } = useSessionData<SeatmapResponse>(seatmapKey)
  const tableLabels = seatmap?.layout?.layout.tables.map((t) => t.label) ?? null
  const marks = seatmap?.marks ?? []
  const byTable = tickets.reduce<Record<string, Ticket[]>>((acc, t) => {
    const k = t.table_label || '미지정'
    acc[k] = acc[k] ?? []
    acc[k].push(t)
    return acc
  }, {})

  const [tableLabel, setTableLabel] = useState('')
  const [body, setBody] = useState('')
  const [severity, setSeverity] = useState<'low' | 'normal' | 'high' | 'blocker'>('normal')
  const [error, setError] = useState<string | null>(null)

  // 운영 콘솔 페이지이므로 participant가 아니라 assistant role로 invoke한다 (seatmap/playbook과 동일 패턴).
  async function add() {
    if (!session || !body.trim()) return
    try {
      const res = await invoke({
        action: 'liveops.create_practice_ticket',
        role: 'assistant',
        scope: { sessionId: session.id },
        input: { sessionId: session.id, tableLabel, body, severity }
      })
      if (!res?.ok) {
        setError(`티켓 생성에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setBody('')
      mutate()
    } catch {
      setError('티켓 생성 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  async function setStatus(t: Ticket, status: Ticket['status']) {
    try {
      const res = await invoke({
        action: 'liveops.update_practice_ticket',
        role: 'assistant',
        scope: { sessionId: session!.id },
        input: { ticketId: t.id, status }
      })
      if (!res?.ok) {
        setError(`티켓 상태 변경에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      mutate()
    } catch {
      setError('티켓 상태 변경 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="실습 지원" desc="테이블별 티켓 그루핑" />
      {error ? (
        <div role="status" className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <Card className="mb-4 p-3 flex gap-2 flex-wrap items-center">
        <TableLabelField labels={tableLabels} value={tableLabel} onChange={setTableLabel} />
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="문제 설명" />
        <Select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
          <option value="blocker">blocker</option>
        </Select>
        <Button variant="accent" onClick={add}>티켓 생성</Button>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {Object.entries(byTable).sort().map(([table, items]) => (
          <Card key={table}>
            <GroupCardHeader table={table} ticketCount={items.length} seatProblems={countProblemSeatsForTable(marks, table)} />
            <ul className="divide-y divide-border">
              {items.map((t) => (
                <li key={t.id} className="px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone={t.severity === 'blocker' ? 'danger' : t.severity === 'high' ? 'warn' : 'neutral'}>{t.severity}</Badge>
                    <Badge tone={t.status === 'solved' ? 'accent' : t.status === 'assisting' ? 'info' : 'warn'}>{t.status}</Badge>
                  </div>
                  <div className="text-sm">{t.body}</div>
                  <div className="flex gap-1 mt-2">
                    <Button size="sm" onClick={() => setStatus(t, 'assisting')}>지원중</Button>
                    <Button size="sm" variant="accent" onClick={() => setStatus(t, 'solved')}>해결</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(t, 'follow_up')}>팔로업</Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}

/** 조 그룹 카드 헤더 — 좌석 보드 problem 마크가 있으면 "좌석 문제 N" 배지로 상호 참조. */
function GroupCardHeader({ table, ticketCount, seatProblems }: { table: string; ticketCount: number; seatProblems: number }) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center gap-2">
      <span className="text-sm font-medium text-text">{table}</span>
      {seatProblems > 0 ? <Badge tone="danger">좌석 문제 {seatProblems}</Badge> : null}
      <span className="ml-auto text-xs text-textMute">{ticketCount}건</span>
    </div>
  )
}

/** 조 라벨 입력 — 레이아웃이 있으면 드롭다운(라벨 파편화 방지), 없으면 기존 자유 텍스트 fallback. */
function TableLabelField({
  labels,
  value,
  onChange
}: {
  labels: string[] | null
  value: string
  onChange: (v: string) => void
}) {
  const [customMode, setCustomMode] = useState(false)
  if (!labels || labels.length === 0) {
    return (
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="조 이름 (예: 3조)"
        aria-label="조 직접 입력"
        className="max-w-[160px] min-h-[44px]"
      />
    )
  }
  const selected = customMode ? CUSTOM_TABLE : labels.includes(value) ? value : ''
  return (
    <>
      <Select
        aria-label="조 선택"
        value={selected}
        className="min-h-[44px]"
        onChange={(e) => {
          if (e.target.value === CUSTOM_TABLE) {
            setCustomMode(true)
            onChange('')
            return
          }
          setCustomMode(false)
          onChange(e.target.value)
        }}
      >
        <option value="">조 선택</option>
        {labels.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
        <option value={CUSTOM_TABLE}>직접 입력</option>
      </Select>
      {customMode ? (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="조 이름 직접 입력"
          aria-label="조 직접 입력"
          className="max-w-[160px] min-h-[44px]"
        />
      ) : null}
    </>
  )
}
