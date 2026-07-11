'use client'

import { useEffect, useState } from 'react'
import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import type { StructuredObservation } from '@/lib/liveops/types'
import { evaluateProgress } from '@/lib/liveops/timeline-compare'

type Planned = { url?: string; chapters: { id: string; title: string; start: string; end: string }[] }

// 계산 로직은 lib/liveops/timeline-compare.ts(순수 함수 + vitest 테스트)에 있다 — 오판 재발 방지.
export function TimelineCompare({ planned, observations, sessionDate }: { planned?: Planned; observations: StructuredObservation[]; sessionDate: string }) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 20000)
    return () => clearInterval(t)
  }, [])

  if (!planned?.chapters?.length) return null
  const { chs, expectedIdx, inGap, actualIdx, tone, label } = evaluateProgress(planned.chapters, sessionDate, now, observations)
  const expected = expectedIdx >= 0 ? chs[expectedIdx] : null
  const actual = actualIdx >= 0 ? chs[actualIdx] : null

  return (
    <Card>
      <CardHeader title="기획 타임라인 vs 실제 진행" hint={planned.url ? '기획안 연동' : undefined} />
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <Badge tone={tone}>{label}</Badge>
          <span className="text-textDim">계획상 현재: <b className="text-text">{expected ? `${expected.title}` : '—'}</b>{inGap ? ' (휴식·이동)' : ''} <span className="text-textMute">{expected ? `${expected.start}~${expected.end}` : ''}</span></span>
          <span className="text-textDim">실제 진행: <b className="text-text">{actual ? actual.title : '추론 대기'}</b> <span className="text-textMute">{actual ? '(관찰 기준)' : ''}</span></span>
        </div>
        <ul className="divide-y divide-border/60 rounded-lg border border-border overflow-hidden">
          {chs.map((c, i) => {
            const done = now !== null && now >= c.endMs
            const isExpected = i === expectedIdx
            const isActual = i === actualIdx
            return (
              <li key={c.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${isActual ? 'bg-accent/5' : ''}`}>
                <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${isActual ? 'bg-accent' : done ? 'bg-textMute' : 'bg-warn'}`} aria-hidden="true" />
                <span className="text-xs text-textMute w-24 shrink-0 tabular-nums">{c.start}~{c.end}</span>
                <span className={`flex-1 min-w-0 truncate ${done && !isActual ? 'text-textMute' : 'text-text'}`}>{c.title}</span>
                <span className="flex gap-1 shrink-0">
                  {isActual ? <Badge tone="accent">실제 진행</Badge> : null}
                  {isExpected && !isActual ? <Badge tone="info">계획상 현재</Badge> : null}
                  {done && !isActual && !isExpected ? <span className="text-xs text-textMute">완료</span> : null}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}
