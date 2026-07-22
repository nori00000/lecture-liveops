'use client'

import { use } from 'react'
import useSWR from 'swr'
import { swrFetcher } from '@/lib/api/fetcher'
import type { SnapshotPayload, StatementMetric, MinorityFlag } from '@/lib/delib/metrics'

type ProjectorData = {
  ok: boolean
  published?: boolean
  session?: { id: string; title: string; date: string }
  payload?: SnapshotPayload
  statementBodies?: Record<string, string>
  publishedAt?: string | null
}

// 프로젝터 발표용 결과판 — 2~5초 폴링(§3). 발표 화면이므로 사이드바 없는 전체화면 레이아웃.
const POLL_MS = 4000
const TOP_N = 5

export default function ProjectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const { data } = useSWR<ProjectorData>(`/api/data/delib/projector-view?sessionId=${encodeURIComponent(sessionId)}`, swrFetcher, { refreshInterval: POLL_MS })

  const bodies = data?.statementBodies ?? {}
  const bodyOf = (id: string) => bodies[id] ?? '(발언 원문 없음)'

  if (data && data.ok && data.published === false) {
    return (
      <main className="min-h-screen bg-bg text-text flex flex-col items-center justify-center p-10 text-center">
        <div className="text-3xl font-semibold mb-3">{data.session?.title ?? '숙의 워크숍'}</div>
        <p className="text-lg text-textDim">아직 발행된 결과가 없습니다. 진행자가 결과를 발행하면 이 화면에 표시됩니다.</p>
      </main>
    )
  }

  const payload = data?.payload
  const consensus = (payload?.consensus ?? []).slice(0, TOP_N)
  const divisive = (payload?.divisive ?? []).slice(0, TOP_N)
  const minority = (payload?.minority ?? []).slice(0, TOP_N)
  const suppressedCount = (payload?.statements ?? []).filter((s) => s.suppressed).length
  const overall = payload?.overall

  return (
    <main className="min-h-screen bg-bg text-text p-6 lg:p-10">
      <header className="mb-6 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl lg:text-4xl font-bold">{data?.session?.title ?? '숙의 워크숍'}</h1>
          <p className="text-textDim mt-1">{data?.session?.date}</p>
        </div>
        {overall ? (
          <div className="flex items-center gap-4 text-lg">
            <span className="text-accent">찬성 {overall.agree}</span>
            <span className="text-danger">반대 {overall.disagree}</span>
            <span className="text-textDim">유보 {overall.pass}</span>
          </div>
        ) : null}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ResultColumn title="공감대" accent="text-accent" empty="표본 부족 — 집계할 합의 항목이 없습니다">
          {consensus.map((m) => <ConsensusRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>

        <ResultColumn title="쟁점" accent="text-warn" empty="표본 부족 — 갈린 항목이 없습니다">
          {divisive.map((m) => <DivisiveRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>

        <ResultColumn title="소수 관점" accent="text-info" empty="소수 관점으로 분류된 항목이 없습니다">
          {minority.map((m) => <MinorityRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>
      </div>

      {suppressedCount > 0 ? (
        <p className="mt-6 text-sm text-textMute">
          유효표 부족(3표 미만)으로 표본 부족 처리된 항목 {suppressedCount}건은 개인 식별 방지를 위해 결과에서 제외되었습니다.
        </p>
      ) : null}
    </main>
  )
}

function ResultColumn({ title, accent, empty, children }: { title: string; accent: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children]
  const hasItems = items.some(Boolean)
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className={`text-2xl font-semibold mb-4 ${accent}`}>{title}</h2>
      {hasItems ? <div className="space-y-4">{children}</div> : <p className="text-textDim">{empty}</p>}
    </section>
  )
}

// agree/disagree 비율 막대 — 색+수치 이중 표기.
function AgreeBar({ m }: { m: StatementMetric }) {
  const sided = m.agree + m.disagree
  const agreePct = sided > 0 ? Math.round((m.agree / sided) * 100) : 0
  return (
    <div>
      <div className="h-3 w-full rounded-full overflow-hidden flex bg-surfaceAlt" role="img" aria-label={`찬성 ${m.agree}표, 반대 ${m.disagree}표`}>
        <div className="h-full bg-accent" style={{ width: `${agreePct}%` }} />
        <div className="h-full bg-danger" style={{ width: `${100 - agreePct}%` }} />
      </div>
      <div className="mt-1 text-sm text-textDim flex gap-3">
        <span className="text-accent">찬성 {m.agree}</span>
        <span className="text-danger">반대 {m.disagree}</span>
        {m.pass > 0 ? <span className="text-textMute">유보 {m.pass}</span> : null}
      </div>
    </div>
  )
}

function ConsensusRow({ m, body }: { m: StatementMetric; body: string }) {
  return (
    <div className="space-y-2">
      <p className="text-lg leading-snug">{body}</p>
      <AgreeBar m={m} />
      <div className="text-xs text-textMute">합의 강도 {Math.round(m.consensusScore * 100)}%</div>
    </div>
  )
}

function DivisiveRow({ m, body }: { m: StatementMetric; body: string }) {
  return (
    <div className="space-y-2">
      <p className="text-lg leading-snug">{body}</p>
      <AgreeBar m={m} />
      <div className="text-xs text-textMute">갈림 강도 {Math.round(m.divisiveScore * 100)}%</div>
    </div>
  )
}

// §7-3: 소수 관점은 "지목"이 아니라 요약. 비율만 표기(인원 미표기).
function MinorityRow({ m, body }: { m: MinorityFlag; body: string }) {
  const agreePct = m.total > 0 ? Math.round((m.agree / m.total) * 100) : 0
  return (
    <div className="space-y-1">
      <p className="text-lg leading-snug">{body}</p>
      <div className="text-sm text-textDim">
        전체 다수와 다른 방향 · {m.leaning === 'agree' ? '찬성' : '반대'} 비율 {m.leaning === 'agree' ? agreePct : 100 - agreePct}%
      </div>
    </div>
  )
}
