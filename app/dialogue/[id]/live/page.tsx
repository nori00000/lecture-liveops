'use client'

import { use } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { swrFetcher } from '@/lib/api/fetcher'
import { Badge, Button } from '@/components/ui/primitives'
import type { DialogueStateMap } from '@/lib/dialogue/stateMap'

type Segment = {
  id: string
  speakerTag: string
  groupId: string | null
  startedMs: number
  text: string
  createdAt: string
}

type DialogueLiveData = {
  ok: boolean
  error?: string
  mode?: 'transcript' | 'statement_preview'
  modeLabel?: string
  session?: { id: string; title: string; date: string }
  activeRound?: { id: string; roundIndex: number; title: string } | null
  recording?: { active: boolean; consentAt: string | null; offsiteProcessing: boolean }
  coverage?: { sourceCount: number; segmentCount: number; visibleSegmentCount: number; lastUpdatedAt: string | null }
  segments?: Segment[]
  keywords?: Array<{ term: string; count: number; weight: number }>
  pulse?: { questions: number; agreements: number; disagreements: number; concerns: number }
  mirror?: DialogueStateMap
}

const POLL_MS = 3000

export default function DialogueLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const { data } = useSWR<DialogueLiveData>(`/api/data/dialogue/live?sessionId=${encodeURIComponent(sessionId)}`, swrFetcher, { refreshInterval: POLL_MS })
  const segments = data?.segments ?? []
  const mirror = data?.mirror
  const keywords = data?.keywords ?? []
  const pulse = data?.pulse ?? { questions: 0, agreements: 0, disagreements: 0, concerns: 0 }
  const lastUpdated = data?.coverage?.lastUpdatedAt ? new Date(data.coverage.lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '대기'

  if (data?.ok === false) {
    return (
      <main className="min-h-screen bg-bg text-text flex items-center justify-center p-6">
        <div className="max-w-md rounded-md border border-danger/40 bg-danger/10 p-6 text-sm text-danger">
          대화 렌즈를 불러오지 못했습니다: {data.error ?? '알 수 없는 오류'}
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8 space-y-4">
        <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={data?.mode === 'transcript' ? 'accent' : 'warn'}>{data?.modeLabel ?? '전사 미연결 프리뷰'}</Badge>
              <Badge tone={data?.recording?.active ? 'info' : 'neutral'}>{data?.recording?.active ? '녹음 동의 ON' : '녹음 동의 OFF'}</Badge>
              {data?.activeRound ? <Badge tone="neutral">라운드 {data.activeRound.roundIndex}</Badge> : <Badge tone="neutral">라운드 없음</Badge>}
            </div>
            <h1 className="text-xl font-semibold sm:text-2xl">Dialogue Lens</h1>
            <p className="mt-1 text-sm text-textDim">{data?.session ? `${data.session.title} · ${data.session.date}` : '불러오는 중...'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-textMute">업데이트 {lastUpdated}</span>
            <Link href={`/workshops/${encodeURIComponent(sessionId)}/console`}><Button size="sm">운영 콘솔</Button></Link>
          </div>
        </header>

        {data?.mode === 'statement_preview' ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-textDim">
            실제 전사 입력이 없어서 제출 발언 기반 프리뷰로 표시합니다.
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(380px,0.95fr)]">
          <TranscriptStream segments={segments} />
          <MirrorPanel mirror={mirror} pulse={pulse} keywords={keywords} />
        </section>
      </div>
    </main>
  )
}

function TranscriptStream({ segments }: { segments: Segment[] }) {
  return (
    <section className="min-h-[640px] rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">대화 흐름</h2>
        <span className="text-xs text-textMute">{segments.length}개 구간</span>
      </div>
      <ol className="max-h-[72vh] divide-y divide-border overflow-auto scrollbar-thin">
        {segments.length === 0 ? <li className="px-4 py-12 text-center text-sm text-textDim">표시할 대화가 없습니다.</li> : null}
        {segments.slice().reverse().map((s) => (
          <li key={s.id} className="grid grid-cols-[76px_minmax(0,1fr)] gap-3 px-4 py-3">
            <div className="text-xs tabular-nums text-textMute">
              <div>{formatMs(s.startedMs)}</div>
              <div className="mt-1 truncate text-textDim">{s.speakerTag || 'speaker'}</div>
            </div>
            <p className="text-base leading-relaxed text-text break-words">{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}

function MirrorPanel({
  mirror,
  pulse,
  keywords
}: {
  mirror: DialogueStateMap | undefined
  pulse: { questions: number; agreements: number; disagreements: number; concerns: number }
  keywords: Array<{ term: string; count: number; weight: number }>
}) {
  return (
    <section className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="grid grid-cols-4 gap-2">
          <Signal label="질문" value={pulse.questions} className="bg-info" />
          <Signal label="동의" value={pulse.agreements} className="bg-accent" />
          <Signal label="반대" value={pulse.disagreements} className="bg-danger" />
          <Signal label="우려" value={pulse.concerns} className="bg-warn" />
        </div>
        <p className="mt-3 text-xs text-textMute">{mirror?.hygiene.participantFacingCopy ?? '대화 상태를 준비하고 있습니다.'}</p>
      </div>

      <MirrorSection title="열린 질문" count={mirror?.openQuestions.length ?? 0}>
        {(mirror?.openQuestions ?? []).slice(0, 5).map((q) => (
          <MirrorItem key={q.id} badge={q.status === 'open' ? '답변 대기' : '다뤄짐'} tone={q.status === 'open' ? 'warn' : 'info'} body={q.text} hint={q.prompt} />
        ))}
      </MirrorSection>

      <MirrorSection title="정의 확인" count={mirror?.conceptThreads.length ?? 0}>
        {(mirror?.conceptThreads ?? []).slice(0, 5).map((c) => (
          <MirrorItem
            key={c.term}
            badge={c.posture === 'needs_definition' ? '의미 조율' : '안정'}
            tone={c.posture === 'needs_definition' ? 'warn' : 'neutral'}
            body={c.term}
            hint={c.prompt}
            chips={c.contexts}
          />
        ))}
      </MirrorSection>

      <MirrorSection title="근거 연결" count={mirror?.evidenceConnections.length ?? 0}>
        {(mirror?.evidenceConnections ?? []).slice(0, 5).map((e) => (
          <MirrorItem key={e.segmentId} badge={e.posture === 'waiting' ? '연결 대기' : '연결됨'} tone={e.posture === 'waiting' ? 'warn' : 'accent'} body={e.text} hint={e.hint} />
        ))}
      </MirrorSection>

      <MirrorSection title="갈림 축" count={mirror?.tensionAxes.length ?? 0}>
        {(mirror?.tensionAxes ?? []).map((a) => (
          <div key={a.id} className="rounded border border-border bg-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{a.label}</span>
              <span className="text-xs text-textDim">{a.leftCount}:{a.rightCount}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-textDim">
              <div className="rounded bg-surfaceAlt px-2 py-1">{a.left}</div>
              <div className="rounded bg-surfaceAlt px-2 py-1">{a.right}</div>
            </div>
            <p className="mt-2 text-xs text-textMute">{a.prompt}</p>
          </div>
        ))}
      </MirrorSection>

      <MirrorSection title="합의 후보" count={mirror?.commonGround.length ?? 0}>
        {(mirror?.commonGround ?? []).map((g) => (
          <MirrorItem key={g.id} badge={`${g.segmentIds.length}회`} tone="accent" body={g.label} hint={g.prompt} />
        ))}
      </MirrorSection>

      <MirrorSection title="키워드" count={keywords.length}>
        <div className="flex flex-wrap gap-1.5">
          {keywords.slice(0, 16).map((k) => (
            <span key={k.term} className="inline-flex items-center gap-1 rounded border border-border bg-bg px-2 py-1 text-xs text-textDim">
              <span>{k.term}</span>
              <span className="text-[10px] text-textMute">{k.count}</span>
            </span>
          ))}
        </div>
      </MirrorSection>
    </section>
  )
}

function MirrorSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-xs text-textMute">{count}</span>
      </div>
      <div className="space-y-2 p-3">
        {count === 0 ? <p className="px-1 py-4 text-center text-sm text-textDim">아직 표시할 상태가 없습니다.</p> : children}
      </div>
    </section>
  )
}

function MirrorItem({
  badge,
  tone,
  body,
  hint,
  chips = []
}: {
  badge: string
  tone: 'neutral' | 'accent' | 'warn' | 'danger' | 'info'
  body: string
  hint: string
  chips?: string[]
}) {
  return (
    <div className="rounded border border-border bg-bg p-3">
      <div className="mb-1 flex items-center gap-2"><Badge tone={tone}>{badge}</Badge></div>
      <p className="text-sm leading-relaxed text-text break-words">{body}</p>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => <span key={c} className="rounded bg-surfaceAlt px-1.5 py-0.5 text-[11px] text-textDim">{c}</span>)}
        </div>
      ) : null}
      <p className="mt-2 text-xs text-textMute">{hint}</p>
    </div>
  )
}

function Signal({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="min-h-[60px] rounded border border-border bg-bg p-2">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${className}`} />
        <span className="text-[11px] text-textDim">{label}</span>
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
