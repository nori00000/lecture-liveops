'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/primitives'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { SituationHero } from './SituationHero'
import { ProgramTimeline } from './ProgramTimeline'
import { RoleActionPanel } from './RoleActionPanel'
import { QuickNoteComposer } from './QuickNoteComposer'
import { MaterialStatusPanel } from './MaterialStatusPanel'
import { ObservationTimeline } from './ObservationTimeline'
import { TeamStatusStrip } from './TeamStatusStrip'
import { TimelineCompare } from './TimelineCompare'
import type { buildSessionDashboard } from '@/lib/liveops/dashboard'

type DashboardData = ReturnType<typeof buildSessionDashboard>
type PlannedTimeline = { url?: string; chapters: { id: string; title: string; start: string; end: string }[] }

// 상황판 위젯의 라이브 래퍼 — 서버 1회 렌더(initial)로 시작하고 2초 폴링으로 갱신한다.
// 빠른 입력 제출(onDone) 시 즉시 재검증 — 새로고침 없이 타임라인/현재 상황에 반영.
export function DashboardLive({ sessionId, initial, planned }: { sessionId: string; initial: DashboardData; planned?: PlannedTimeline }) {
  const { data, mutate } = useSessionData<DashboardData>(
    `/api/data/session-dashboard?sessionId=${encodeURIComponent(sessionId)}`,
    2000
  )
  const d = data ?? initial
  const [htmlBusy, setHtmlBusy] = useState(false)
  const [htmlMsg, setHtmlMsg] = useState('')

  // 신규 긴급 도착 인지 — 폴링으로 미해결 urgent 건수가 늘면 배너로 알린다(놓침 방지).
  const urgentCount = d.observations.filter((o) => o.severity === 'urgent' && !o.resolved && o.category !== 'solution').length
  const prevUrgent = useRef(urgentCount)
  const [newUrgent, setNewUrgent] = useState(0)
  useEffect(() => {
    if (urgentCount > prevUrgent.current) {
      const delta = urgentCount - prevUrgent.current
      prevUrgent.current = urgentCount
      setNewUrgent((n) => n + delta)
      const t = setTimeout(() => setNewUrgent(0), 8000)
      return () => clearTimeout(t)
    }
    prevUrgent.current = urgentCount
  }, [urgentCount])

  // 세션 아카이브를 LLM 기반 HTML로 생성해 즉시 다운로드 (상황판에서 바로).
  async function downloadHtml() {
    if (htmlBusy) return
    setHtmlBusy(true)
    setHtmlMsg('HTML 생성 중… (최대 1분)')
    try {
      const res = await fetch(`/api/export/html?sessionId=${encodeURIComponent(sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''(.+)$/)
      a.download = m ? decodeURIComponent(m[1]) : 'session.html'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setHtmlMsg('HTML 다운로드 완료')
    } catch (e) {
      setHtmlMsg(e instanceof Error ? e.message : 'HTML 생성 실패')
    } finally {
      setHtmlBusy(false)
    }
  }

  return (
    <>
      {newUrgent > 0 ? (
        <div role="alert" className="rounded border border-danger/40 bg-danger/15 text-danger px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="w-2 h-2 rounded-full bg-danger animate-pulse" />
            긴급 {newUrgent}건이 새로 들어왔습니다
          </span>
          <button type="button" onClick={() => setNewUrgent(0)} className="text-xs underline shrink-0">확인</button>
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-3">
        {htmlMsg ? <span className="text-xs text-textDim" role="status" aria-live="polite">{htmlMsg}</span> : null}
        <Button variant="accent" onClick={downloadHtml} disabled={htmlBusy}>{htmlBusy ? 'HTML 생성 중…' : 'HTML 생성하기'}</Button>
      </div>
      <SituationHero snapshot={d.snapshot} />
      <TeamStatusStrip sessionId={sessionId} />
      {d.meta?.program?.length ? <ProgramTimeline program={d.meta.program} sessionDate={String(d.session.date).slice(0, 10)} /> : null}
      {planned?.chapters?.length ? <TimelineCompare planned={planned} observations={d.observations} sessionDate={String(d.session.date).slice(0, 10)} /> : null}
      <RoleActionPanel
        snapshot={d.snapshot}
        observations={d.observations}
        onResolve={async (id) => {
          try {
            await invoke({ action: 'liveops.resolve_observation', role: 'assistant', scope: { sessionId }, input: { sessionId, observationId: id } })
          } finally {
            void mutate()
          }
        }}
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <QuickNoteComposer sessionId={sessionId} onDone={() => void mutate()} />
        <MaterialStatusPanel materials={d.materials} />
      </div>
      <ObservationTimeline
        observations={d.observations}
        onUpdate={async (id, patch) => {
          try {
            await invoke({ action: 'liveops.update_observation', role: 'assistant', scope: { sessionId }, input: { sessionId, observationId: id, ...patch } })
          } finally {
            void mutate()
          }
        }}
        onDelete={async (id) => {
          // 타임라인에는 live_observation(ob-)과 ops_log(op-, 좌석일지·빠른노트)가 함께 표시된다.
          // id prefix로 올바른 삭제 액션을 선택한다.
          const isOps = id.startsWith('op-')
          try {
            await invoke({
              action: isOps ? 'liveops.delete_ops_log' : 'liveops.delete_observation',
              role: 'assistant',
              scope: { sessionId },
              input: isOps ? { sessionId, opsLogId: id } : { sessionId, observationId: id }
            })
          } finally {
            void mutate()
          }
        }}
      />
    </>
  )
}
