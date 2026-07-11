'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader } from '@/components/ui/primitives'

type Item = { time: string; title: string }
type Status = 'done' | 'current' | 'upcoming'

// "09:10-09:30" / "09:10 ~ 09:30" → 세션 날짜(KST)의 시작·끝 epoch(ms). 파싱 실패 시 null.
function parseSlot(time: string, sessionDate: string): { start: number; end: number } | null {
  const m = time.match(/(\d{1,2}):(\d{2})\s*[-~–]\s*(\d{1,2}):(\d{2})/)
  if (!m) return null
  const pad = (s: string) => s.padStart(2, '0')
  const start = new Date(`${sessionDate}T${pad(m[1])}:${m[2]}:00+09:00`).getTime()
  let end = new Date(`${sessionDate}T${pad(m[3])}:${m[4]}:00+09:00`).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  if (end < start) end += 24 * 60 * 60 * 1000 // 자정 넘김 방어
  return { start, end }
}

function statusOf(slot: { start: number; end: number } | null, now: number | null): Status {
  if (now === null || !slot) return 'upcoming'
  if (now >= slot.end) return 'done'
  if (now >= slot.start) return 'current'
  return 'upcoming'
}

// 진행 순서(아젠다) — 화면에 표시하고, 현재 시각(KST) 기준으로 지난 항목은 자동으로 체크된다.
// SSR/CSR 하이드레이션 불일치를 피하려 now는 마운트 후(useEffect)에만 설정한다.
export function ProgramTimeline({ program, sessionDate }: { program: Item[]; sessionDate: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 20000) // 20초마다 자동 갱신 → 시간 지나면 자동 체크
    return () => clearInterval(t)
  }, [])

  if (!program.length) return null

  const rows = program.map((it) => ({ ...it, st: statusOf(parseSlot(it.time, sessionDate), now) }))
  const doneCount = rows.filter((r) => r.st === 'done').length
  const current = rows.find((r) => r.st === 'current')
  const hint = current
    ? `진행 중 · ${current.title}`
    : now !== null && doneCount === rows.length
      ? '종료'
      : now !== null && doneCount === 0
        ? '시작 전'
        : `${doneCount}/${rows.length} 완료`

  return (
    <Card>
      <CardHeader title="진행 순서" hint={`${doneCount}/${rows.length} 완료`} />
      <p className="sr-only" role="status" aria-live="polite">{hint}</p>
      <ul className="divide-y divide-border">
        {rows.map((r, i) => (
          <li
            key={`${r.time}-${i}`}
            aria-current={r.st === 'current' ? 'step' : undefined}
            className={`px-4 py-2 flex items-center gap-3 ${r.st === 'current' ? 'bg-accent/10' : ''}`}
          >
            <StatusIcon st={r.st} />
            {r.st !== 'current' ? <span className="sr-only">{r.st === 'done' ? '완료' : '예정'}</span> : null}
            <span className={`text-xs w-[5.5rem] shrink-0 tabular-nums ${r.st === 'done' ? 'text-textMute' : 'text-textDim'}`}>
              {r.time}
            </span>
            <span
              className={
                r.st === 'done'
                  ? 'text-sm text-textMute line-through decoration-textMute/50'
                  : r.st === 'current'
                    ? 'text-sm text-text font-semibold'
                    : 'text-sm text-text'
              }
            >
              {r.title}
            </span>
            {r.st === 'current' ? <span className="ml-auto text-[11px] text-accent shrink-0">진행 중</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function StatusIcon({ st }: { st: Status }) {
  if (st === 'done') {
    return (
      <span aria-hidden="true" className="shrink-0 w-4 h-4 rounded-full bg-accent/20 border border-accent/50 text-accent flex items-center justify-center">
        <svg viewBox="0 0 12 12" className="w-2.5 h-2.5">
          <path d="M2.5 6.2 L5 8.5 L9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    )
  }
  if (st === 'current') {
    return <span aria-hidden="true" className="shrink-0 w-3 h-3 rounded-full bg-accent animate-pulse ml-0.5 mr-0.5" />
  }
  return <span aria-hidden="true" className="shrink-0 w-3 h-3 rounded-full border border-textMute/50 ml-0.5 mr-0.5" />
}
