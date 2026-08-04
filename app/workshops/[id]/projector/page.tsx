'use client'

import { use } from 'react'
import useSWR from 'swr'
import { swrFetcher } from '@/lib/api/fetcher'
import type { StatementMetric, MinorityFlag } from '@/lib/delib/metrics'
import {
  explainedVarianceWarning,
  landscapeReasonText,
  stabilityWarning,
  type LandscapeResult,
  type LiftBucket,
  type SnapshotPayloadWithLandscape
} from '@/lib/delib/landscapeMetrics'

type ProjectorData = {
  ok: boolean
  published?: boolean
  session?: { id: string; title: string; date: string }
  payload?: SnapshotPayloadWithLandscape
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
  const opposed = (payload?.opposed ?? []).slice(0, TOP_N)
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <ResultColumn title="공감대 (찬성)" accent="text-accent" empty="표본 부족 — 집계할 합의 항목이 없습니다">
          {consensus.map((m) => <ConsensusRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>

        {/* 반대 합의를 공감대에 섞으면 "찬 4 / 반 16" 이 공감대로 뜬다. 방향별로 칸을 나눈다. */}
        <ResultColumn title="반대 합의" accent="text-danger" empty="다수가 반대로 모인 항목이 없습니다">
          {opposed.map((m) => <OpposedRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>

        <ResultColumn title="쟁점" accent="text-warn" empty="표본 부족 — 갈린 항목이 없습니다">
          {divisive.map((m) => <DivisiveRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>

        <ResultColumn title="소수 관점" accent="text-info" empty="소수 관점으로 분류된 항목이 없습니다">
          {minority.map((m) => <MinorityRow key={m.statementId} m={m} body={bodyOf(m.statementId)} />)}
        </ResultColumn>
      </div>

      <LandscapeSection landscape={payload?.landscape} bodyOf={bodyOf} />

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

function OpposedRow({ m, body }: { m: StatementMetric; body: string }) {
  return (
    <div className="space-y-2">
      <p className="text-lg leading-snug">{body}</p>
      <AgreeBar m={m} />
      <div className="text-xs text-textMute">반대 합의 강도 {Math.round(m.consensusScore * 100)}%</div>
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

// ============================================================
// 의견 지형 (Post-MVP B / 통계 하드닝 2026-07-22)
// H2: 개별 좌표(projection)는 공개 화면에 노출하지 않는다 — 좌표는 개인 투표 벡터의 저차원
//     서명이라 공개 발언·현장 관찰과 결합하면 재식별이 가능하다. 클러스터 규모·대표문장만 보여준다.
// C3: 설명분산이 낮으면 경고 배지를 띄운다. 애초에 산점도를 그리지 않으므로
//     "30%든 90%든 똑같이 권위 있어 보이는 그림" 문제 자체가 사라진다.
// H3: 대표의견은 정확 수치 대신 순위 + 효과크기 bucket 으로만 표기한다.
// 접근성: 색이 유일한 정보수단이 되지 않게 클러스터마다 라벨(가/나/다…)을 병행한다.
// ============================================================

const CLUSTER_LABELS = ['가', '나', '다', '라', '마']
const CLUSTER_COLORS = ['text-accent', 'text-warn', 'text-info', 'text-danger', 'text-textDim']
const CLUSTER_BARS = ['bg-accent', 'bg-warn', 'bg-info', 'bg-danger', 'bg-textDim']

const BUCKET_TEXT: Record<LiftBucket, string> = {
  strong: '뚜렷한 차이',
  moderate: '중간 정도 차이',
  slight: '약한 차이'
}

function LandscapeSection({ landscape, bodyOf }: { landscape?: LandscapeResult; bodyOf: (id: string) => string }) {
  if (!landscape) return null

  if (!landscape.enabled) {
    return (
      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-2xl font-semibold mb-2">의견 지형</h2>
        <p className="text-textDim">{landscapeReasonText(landscape)}</p>
      </section>
    )
  }

  const varianceNote = explainedVarianceWarning(landscape)
  const stabilityNote = stabilityWarning(landscape)
  const maxSize = Math.max(1, ...landscape.clusters.map((c) => c.size))

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <h2 className="text-2xl font-semibold">의견 지형</h2>
        <p className="text-sm text-textDim">
          참가자 {landscape.eligibleCount}명(7표 이상) · 그룹 {landscape.k}개 · 설명력 {Math.round(landscape.explainedVarianceRatio * 100)}%
        </p>
      </div>

      {varianceNote ? (
        <p className="mb-3 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-warn">{varianceNote}</p>
      ) : null}
      {stabilityNote ? (
        <p className="mb-3 rounded-md border border-warn/50 bg-warn/10 px-3 py-2 text-sm text-warn">{stabilityNote}</p>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h3 className="text-lg font-semibold mb-2">그룹 규모</h3>
          <ul className="space-y-2">
            {landscape.clusters.map((c) => (
              <li key={c.id}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className={`font-semibold ${CLUSTER_COLORS[c.id % CLUSTER_COLORS.length]}`}>
                    {CLUSTER_LABELS[c.id % CLUSTER_LABELS.length]} 그룹
                  </span>
                  <span className="text-textDim">{c.size}명</span>
                </div>
                <div className="mt-1 h-3 w-full rounded-full bg-surfaceAlt overflow-hidden" role="img" aria-label={`${CLUSTER_LABELS[c.id % CLUSTER_LABELS.length]} 그룹 ${c.size}명`}>
                  <div className={`h-full ${CLUSTER_BARS[c.id % CLUSTER_BARS.length]}`} style={{ width: `${(c.size / maxSize) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-textMute">
            그룹은 투표 패턴이 비슷한 참가자 묶음입니다. 개인 좌표는 재식별 위험이 있어 화면에 표시하지 않습니다.
          </p>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-lg font-semibold mb-2">모든 그룹이 함께 지지한 의견</h3>
            {landscape.gic.length === 0 ? (
              <p className="text-textDim text-sm">표본 부족 — 표시할 항목이 없습니다</p>
            ) : (
              <ol className="space-y-2">
                {landscape.gic.slice(0, 3).map((g) => (
                  <li key={g.statementId} className="text-base leading-snug">
                    {bodyOf(g.statementId)}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold mb-2">그룹별 대표 의견</h3>
            {landscape.representatives.length === 0 ? (
              <p className="text-textDim text-sm">이 그룹들을 뚜렷이 구분짓는 발언이 통계적으로 확인되지 않았습니다</p>
            ) : (
              <div className="space-y-3">
                {landscape.clusters.map((c) => {
                  const items = landscape.representatives.filter((r) => r.clusterId === c.id).slice(0, 2)
                  if (items.length === 0) return null
                  return (
                    <div key={c.id} className="rounded-md border border-border p-3">
                      <div className={`text-sm font-semibold mb-1 ${CLUSTER_COLORS[c.id % CLUSTER_COLORS.length]}`}>
                        {CLUSTER_LABELS[c.id % CLUSTER_LABELS.length]} 그룹 · {c.size}명
                      </div>
                      <ul className="space-y-1">
                        {items.map((r) => (
                          <li key={r.statementId} className="text-base leading-snug">
                            {bodyOf(r.statementId)}
                            <span className="text-xs text-textMute"> · {r.rank}순위 · 다른 그룹과 {BUCKET_TEXT[r.bucket]}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
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
