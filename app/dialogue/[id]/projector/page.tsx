'use client'

import { use } from 'react'
import useSWR from 'swr'
import { swrFetcher } from '@/lib/api/fetcher'
import { Badge } from '@/components/ui/primitives'

type ProjectorData = {
  ok: boolean
  error?: string
  mode?: 'transcript' | 'statement_preview'
  modeLabel?: string
  session?: { id: string; title: string; date: string }
  activeRound?: { id: string; roundIndex: number; title: string } | null
  recording?: { active: boolean; consentAt: string | null }
  segments?: Array<{ id: string; speakerTag: string; startedMs: number; text: string }>
  pulse?: { questions: number; agreements: number; disagreements: number; concerns: number }
  keywords?: Array<{ term: string; count: number; weight: number }>
  mirror?: {
    openQuestions: Array<{ id: string; text: string; prompt: string; status: 'open' | 'touched' }>
    conceptThreads: Array<{ term: string; prompt: string; contexts: string[] }>
    tensionAxes: Array<{ id: string; label: string; left: string; right: string; leftCount: number; rightCount: number; prompt: string }>
    commonGround: Array<{ id: string; label: string; prompt: string; mentionCount: number }>
    hygiene: { participantFacingCopy: string }
  }
  nudges?: Array<{ id: string; kind: string; label: string; prompt: string; priority: 'low' | 'medium' }>
}

const POLL_MS = 3000

export default function DialogueProjectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const { data } = useSWR<ProjectorData>(`/api/data/dialogue/projector?sessionId=${encodeURIComponent(sessionId)}`, swrFetcher, { refreshInterval: POLL_MS })

  if (data?.ok === false) {
    return (
      <main className="min-h-screen bg-bg text-text flex items-center justify-center p-8">
        <div className="rounded-md border border-danger/40 bg-danger/10 p-6 text-danger">Room Mirror를 불러오지 못했습니다: {data.error ?? '알 수 없는 오류'}</div>
      </main>
    )
  }

  const pulse = data?.pulse ?? { questions: 0, agreements: 0, disagreements: 0, concerns: 0 }
  const nudges = data?.nudges ?? []
  const primaryNudge = nudges[0]
  const mirror = data?.mirror
  const segments = data?.segments ?? []
  const statusCounts = {
    questions: mirror?.openQuestions.length ?? 0,
    concepts: mirror?.conceptThreads.length ?? 0,
    axes: mirror?.tensionAxes.length ?? 0,
    grounds: mirror?.commonGround.length ?? 0
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto flex min-h-screen max-w-[1700px] flex-col gap-5 p-6 lg:p-8">
        <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={data?.mode === 'transcript' ? 'accent' : 'warn'}>{data?.modeLabel ?? '전사 미연결 프리뷰'}</Badge>
              <Badge tone={data?.recording?.active ? 'info' : 'neutral'}>{data?.recording?.active ? '녹음 동의 ON' : '녹음 동의 OFF'}</Badge>
              {data?.activeRound ? <Badge tone="neutral">라운드 {data.activeRound.roundIndex}</Badge> : <Badge tone="neutral">라운드 없음</Badge>}
            </div>
            <h1 className="text-3xl font-semibold leading-tight">Room Mirror</h1>
            <p className="mt-1 text-base text-textDim">{data?.session ? `${data.session.title} · ${data.session.date}` : '대화 상태를 불러오는 중...'}</p>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-textMute">{mirror?.hygiene.participantFacingCopy ?? 'AI는 발언자를 평가하지 않고, 대화에서 확인해 볼 상태만 보여줍니다.'}</p>
        </header>

        <section className="grid grid-cols-4 gap-2 xl:hidden" aria-label="대화 상태 요약">
          <CompactSignal label="질문" value={statusCounts.questions} />
          <CompactSignal label="정의" value={statusCounts.concepts} />
          <CompactSignal label="갈림" value={statusCounts.axes} />
          <CompactSignal label="합의" value={statusCounts.grounds} />
        </section>

        <section className="grid flex-1 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.65fr)]">
          <div className="space-y-5">
            <section className="rounded-md border border-accentDim/50 bg-accentDim/10 p-4 sm:p-5">
              <div className="text-sm text-accent">다음에 확인할 지점</div>
              <div className="mt-2 min-h-[92px] text-2xl font-semibold leading-snug sm:min-h-[116px] sm:text-3xl">
                {primaryNudge ? primaryNudge.prompt : '대화가 더 쌓이면 함께 확인할 지점이 표시됩니다.'}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <MirrorColumn title="열린 질문" count={mirror?.openQuestions.length ?? 0}>
                {(mirror?.openQuestions ?? []).map((q) => (
                  <StatusLine key={q.id} title={q.text} meta={q.status === 'open' ? '답변 대기' : '다뤄짐'} />
                ))}
              </MirrorColumn>
              <MirrorColumn title="정의 확인" count={mirror?.conceptThreads.length ?? 0}>
                {(mirror?.conceptThreads ?? []).map((c) => (
                  <StatusLine key={c.term} title={c.term} meta={c.prompt} />
                ))}
              </MirrorColumn>
              <MirrorColumn title="갈림 축" count={mirror?.tensionAxes.length ?? 0}>
                {(mirror?.tensionAxes ?? []).map((a) => (
                  <StatusLine key={a.id} title={a.label} meta={`${a.left} ${a.leftCount} · ${a.right} ${a.rightCount}`} />
                ))}
              </MirrorColumn>
              <MirrorColumn title="합의 후보" count={mirror?.commonGround.length ?? 0}>
                {(mirror?.commonGround ?? []).map((g) => (
                  <StatusLine key={g.id} title={g.label} meta={`${g.mentionCount}회 반복`} />
                ))}
              </MirrorColumn>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-md border border-border bg-surface p-4">
              <div className="mb-3 text-sm font-medium">대화 신호</div>
              <div className="grid grid-cols-2 gap-3">
                <Pulse label="질문" value={pulse.questions} className="bg-info" />
                <Pulse label="동의" value={pulse.agreements} className="bg-accent" />
                <Pulse label="반대" value={pulse.disagreements} className="bg-danger" />
                <Pulse label="우려" value={pulse.concerns} className="bg-warn" />
              </div>
            </section>

            <section className="rounded-md border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">최근 대화</h2>
                <span className="text-xs text-textMute">{segments.length}개</span>
              </div>
              <ol className="max-h-[46vh] divide-y divide-border overflow-hidden">
                {segments.slice().reverse().map((s) => (
                  <li key={s.id} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-4 py-3">
                    <div className="text-xs text-textMute">{formatMs(s.startedMs)}</div>
                    <p className="line-clamp-3 text-sm leading-relaxed text-textDim">{s.text}</p>
                  </li>
                ))}
                {segments.length === 0 ? <li className="px-4 py-8 text-center text-sm text-textDim">표시할 대화가 없습니다.</li> : null}
              </ol>
            </section>
          </aside>
        </section>
      </div>
    </main>
  )
}

function MirrorColumn({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="min-h-[220px] rounded-md border border-border bg-surface sm:min-h-[260px]">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-base font-medium">{title}</h2>
        <span className="text-sm text-textMute">{count}</span>
      </div>
      <div className="space-y-3 p-4">
        {count === 0 ? <p className="py-10 text-center text-sm text-textDim">아직 표시할 상태가 없습니다.</p> : children}
      </div>
    </section>
  )
}

function CompactSignal({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-h-[58px] rounded border border-border bg-surface p-2">
      <div className="text-[11px] text-textDim">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-text">{value}</div>
    </div>
  )
}

function StatusLine({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded border border-border bg-bg p-3">
      <div className="break-words text-base leading-relaxed">{title}</div>
      <div className="mt-2 break-words text-xs text-textMute">{meta}</div>
    </div>
  )
}

function Pulse({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="min-h-[82px] rounded border border-border bg-bg p-3">
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
        <span className="text-sm text-textDim">{label}</span>
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
