'use client'

import { use, useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { swrFetcher } from '@/lib/api/fetcher'
import { invoke } from '@/lib/util/envelope'
import { Badge, Button, Card, CardHeader, Input, PageHeader, Select, Textarea } from '@/components/ui/primitives'
import { VoteControls } from '@/components/delib/VoteControls'
import { RecordingBanner } from '@/components/delib/RecordingBanner'
import type { VoteValue } from '@/lib/db/schema'
import type {
  AppSubmissionGroupDistribution,
  AppSubmissionRoundDistribution,
  EvidenceKindRoundBreakdown,
  EvidenceKindDistribution
} from '@/lib/delib/metrics'

type Member = { participantId: string; alias: string }
type GroupView = { id: string; label: string; topic: string; members: Member[] }
type Round = { id: string; round_index: number; title: string; mode: string; status: string }
type Tally = { agree: number; disagree: number; pass: number }
type StatementCard = {
  id: string
  body: string
  groupId: string | null
  roundId: string | null
  moderationState: 'visible' | 'flagged' | 'hidden'
  createdAt: string
  tally: Tally
  total: number
}
type ConsoleData = {
  ok: boolean
  error?: string
  session?: { id: string; title: string; date: string }
  rounds?: Round[]
  activeRound?: Round | null
  groups?: GroupView[]
  participantCount?: number
  statements?: StatementCard[]
  moderationQueue?: StatementCard[]
  voteProgress?: { totalVotes: number; expectedVotes: number; ratio: number }
  snapshots?: { id: string; roundId: string | null; computedAt: string; publishedAt: string | null }[]
  // Q1 근거 유형 분포 — 서버에서 k-익명 억제까지 마친 집계값 (개별 발언 태그는 내려오지 않는다).
  evidenceByRound?: EvidenceKindRoundBreakdown[]
  // Q4 앱 제출 분포 — 서버에서 k-익명/대리입력 억제까지 마친 그룹 단위 집계값.
  appSubmissionByRound?: AppSubmissionRoundDistribution[]
  recording?: { active: boolean; consentAt: string | null; offsiteProcessing: boolean }
  // Q2 검토 후보 — 콘솔 전용. 참가자 화면·프로젝터에는 절대 내려오지 않는다.
  aiObservations?: AiObservationView
}

type AiObservationCandidate = {
  id: string
  statementId: string
  roundId: string | null
  kind: string
  body: string
  suggestedQuestion: string
  statementBody: string
}
type AiObservationView = { pending: AiObservationCandidate[]; approvedCount: number; rejectedCount: number }

type TranscriptLensData = {
  ok: boolean
  error?: string
  mode?: 'transcript' | 'statement_preview'
  modeLabel?: string
  activeRound?: { id: string; roundIndex: number; title: string } | null
  recording?: { active: boolean; consentAt: string | null; offsiteProcessing: boolean }
  coverage?: { sourceCount: number; segmentCount: number; visibleSegmentCount: number; lastUpdatedAt: string | null }
  segments?: Array<{
    id: string
    sourceId: string
    groupId: string | null
    roundId: string | null
    speakerTag: string
    startedMs: number
    endedMs: number
    text: string
    confidence: number | null
    createdAt: string
  }>
  keywords?: Array<{ term: string; count: number; weight: number }>
  groupActivity?: Array<{ groupId: string; label: string; segmentCount: number; textLength: number; share: number }>
  pulse?: { questions: number; agreements: number; disagreements: number; concerns: number }
}

// 콘솔 폴링 2~5초 (§3). 운영 조작 후엔 mutate()로 즉시 반영.
const POLL_MS = 3000

export default function WorkshopConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = use(params)
  const { data, mutate } = useSWR<ConsoleData>(`/api/data/delib/console-view?sessionId=${encodeURIComponent(sessionId)}`, swrFetcher, { refreshInterval: POLL_MS })
  const { data: transcriptLens } = useSWR<TranscriptLensData>(`/api/data/delib/transcript-view?sessionId=${encodeURIComponent(sessionId)}`, swrFetcher, { refreshInterval: POLL_MS })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const allMembers = useMemo(() => {
    const out: Member[] = []
    for (const g of data?.groups ?? []) out.push(...g.members)
    return out
  }, [data])

  async function run(action: string, input: unknown): Promise<boolean> {
    setBusy(true)
    try {
      const res = await invoke({ action, role: 'instructor', scope: { sessionId }, input })
      if (!res?.ok) {
        setError(`${action} 실패: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return false
      }
      setError(null)
      await mutate()
      return true
    } catch {
      setError(`${action} 요청 중 오류가 발생했습니다.`)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (data?.ok === false) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-danger">콘솔 데이터를 불러오지 못했습니다: {data.error ?? '알 수 없는 오류'}</Card>
      </div>
    )
  }

  const progress = data?.voteProgress
  const ratioPct = progress ? Math.round(progress.ratio * 100) : 0

  return (
    <div className="p-6 space-y-4 max-w-6xl">
      <PageHeader
        title="퍼실리테이터 콘솔"
        desc={data?.session ? `${data.session.title} · ${data.session.date}` : '불러오는 중...'}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {data?.activeRound ? <Badge tone="accent">라운드 {data.activeRound.round_index} 진행중</Badge> : <Badge tone="neutral">라운드 없음</Badge>}
            <Badge tone="info">참가자 {data?.participantCount ?? 0}</Badge>
            <Link href={`/workshops/${encodeURIComponent(sessionId)}/projector`} target="_blank"><Button size="sm">프로젝터 열기</Button></Link>
          </div>
        }
      />

      {/* 녹음·전사 상시 배너 — 동의된 세션에서만 노출 */}
      <RecordingBanner active={data?.recording?.active === true} audience="operator" />

      {error ? <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div> : null}

      <TranscriptLensPanel data={transcriptLens} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RoundControl sessionId={sessionId} rounds={data?.rounds ?? []} activeRound={data?.activeRound ?? null} busy={busy} onStart={(input) => run('delib.start_round', input)} />
        <ProjectorPublish sessionId={sessionId} snapshots={data?.snapshots ?? []} activeRoundId={data?.activeRound?.id ?? null} busy={busy} onDone={() => mutate()} onError={setError} />
      </div>

      {/* 결과 리포트 내려받기 — 절차 증빙형 납품물 (md/html/xlsx) */}
      <ReportDownload sessionId={sessionId} />

      {/* Q2 검토 후보 — moderation 큐와 분리된 별도 패널 (품질 피드백 ≠ 제재) */}
      <AiReviewPanel
        view={data?.aiObservations}
        busy={busy}
        onCompute={() => run('delib.compute_ai_observations', { sessionId })}
        onReview={(observationId, decision, reason) => run('delib.review_ai_observation', { observationId, decision, reason: reason || undefined })}
      />

      {/* 투표 진행률 */}
      <Card>
        <CardHeader title="투표 진행률" hint={progress ? `${progress.totalVotes}/${progress.expectedVotes} 표` : undefined} />
        <div className="p-4">
          <div className="h-3 w-full rounded-full bg-surfaceAlt overflow-hidden" role="progressbar" aria-valuenow={ratioPct} aria-valuemin={0} aria-valuemax={100} aria-label="투표 진행률">
            <div className="h-full bg-accent transition-all" style={{ width: `${ratioPct}%` }} />
          </div>
          <div className="mt-1 text-xs text-textDim">{ratioPct}%</div>
        </div>
      </Card>

      {/* Q1 근거 유형 분포 (라운드별 · 그룹 단위) */}
      <EvidencePanel breakdowns={data?.evidenceByRound ?? []} rounds={data?.rounds ?? []} groups={data?.groups ?? []} />

      {/* Q4 앱 제출 분포 (라운드별 · 그룹 단위) */}
      <AppSubmissionPanel breakdowns={data?.appSubmissionByRound ?? []} rounds={data?.rounds ?? []} groups={data?.groups ?? []} />

      {/* 그룹 보드 (좌석맵 재해석 — 그룹별 멤버 카드) */}
      <GroupBoard groups={data?.groups ?? []} />

      {/* moderation 큐 */}
      <ModerationQueue queue={data?.moderationQueue ?? []} busy={busy} onModerate={(statementId, action) => run('delib.moderate_statement', { statementId, action })} />

      {/* 전체 발언 + moderation 조작 */}
      <StatementList statements={data?.statements ?? []} busy={busy} onModerate={(statementId, action) => run('delib.moderate_statement', { statementId, action })} />

      {/* 오프라인 폴백 — 대리 입력 (§7-7) */}
      <ProxyInput
        sessionId={sessionId}
        members={allMembers}
        statements={(data?.statements ?? []).filter((s) => s.moderationState === 'visible')}
        activeRoundId={data?.activeRound?.id ?? null}
        busy={busy}
        onSubmit={(input) => run('delib.submit_statement', input)}
        onVote={(input) => run('delib.vote_statement', input)}
      />
    </div>
  )
}

function RoundControl({
  sessionId,
  rounds,
  activeRound,
  busy,
  onStart
}: {
  sessionId: string
  rounds: Round[]
  activeRound: Round | null
  busy: boolean
  onStart: (input: unknown) => Promise<boolean>
}) {
  const nextIndex = rounds.reduce((m, r) => Math.max(m, r.round_index), -1) + 1
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'plenary' | 'breakout'>('plenary')

  return (
    <Card>
      <CardHeader title="라운드 제어" hint={activeRound ? `현재: 라운드 ${activeRound.round_index}` : '진행 중 없음'} />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">
          새 라운드를 시작하면 현재 진행 중인 라운드는 자동으로 종료됩니다(세션당 활성 라운드 1개).
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input placeholder={`라운드 ${nextIndex} 제목`} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Select value={mode} onChange={(e) => setMode(e.target.value as 'plenary' | 'breakout')}>
            <option value="plenary">전체(plenary)</option>
            <option value="breakout">분임(breakout)</option>
          </Select>
        </div>
        <div className="flex justify-end">
          <Button
            variant="accent"
            disabled={busy}
            onClick={async () => {
              const ok = await onStart({ sessionId, roundIndex: nextIndex, title, mode })
              if (ok) setTitle('')
            }}
          >
            라운드 {nextIndex} 시작
          </Button>
        </div>
        <ul className="divide-y divide-border border-t border-border">
          {rounds.map((r) => (
            <li key={r.id} className="py-2 flex items-center gap-2 text-sm">
              <Badge tone={r.status === 'active' ? 'accent' : r.status === 'closed' ? 'neutral' : 'info'}>{r.status}</Badge>
              <span className="text-textDim">라운드 {r.round_index}</span>
              <span className="truncate">{r.title || '(제목 없음)'}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function ProjectorPublish({
  sessionId,
  snapshots,
  activeRoundId,
  busy,
  onDone,
  onError
}: {
  sessionId: string
  snapshots: { id: string; publishedAt: string | null }[]
  activeRoundId: string | null
  busy: boolean
  onDone: () => void
  onError: (m: string) => void
}) {
  const [working, setWorking] = useState(false)
  const publishedCount = snapshots.filter((s) => s.publishedAt != null).length

  async function computeAndPublish() {
    setWorking(true)
    try {
      const computed = await invoke({
        action: 'delib.compute_snapshot',
        role: 'instructor',
        scope: { sessionId },
        input: { sessionId, roundId: activeRoundId ?? undefined }
      })
      if (!computed?.ok) throw new Error(computed?.error ?? '스냅샷 계산 실패')
      const snapshotId = computed.data?.snapshotId
      if (typeof snapshotId !== 'string') throw new Error('스냅샷 ID 누락')
      const published = await invoke({
        action: 'delib.publish_snapshot',
        role: 'instructor',
        scope: { sessionId },
        input: { snapshotId }
      })
      if (!published?.ok) throw new Error(published?.error ?? '스냅샷 발행 실패')
      onDone()
    } catch (e) {
      onError(e instanceof Error ? e.message : '스냅샷 발행 실패')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Card>
      <CardHeader title="프로젝터 발행" hint={`발행된 스냅샷 ${publishedCount}건`} />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">
          현재 집계를 스냅샷으로 계산해 프로젝터 결과판에 발행합니다. 개인 표는 포함되지 않고 집계·랭킹만 공개됩니다.
        </p>
        <div className="flex justify-end">
          <Button variant="accent" disabled={busy || working} onClick={computeAndPublish}>
            {working ? '발행 중' : '결과 계산 & 발행'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function ReportDownload({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState<null | 'md' | 'html' | 'xlsx'>(null)
  const [msg, setMsg] = useState('')

  async function download(format: 'md' | 'html' | 'xlsx') {
    if (busy) return
    setBusy(format)
    setMsg('생성 중…')
    try {
      const res = await fetch(`/api/export/delib?sessionId=${encodeURIComponent(sessionId)}&format=${format}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''(.+)$/)
      a.download = m ? decodeURIComponent(m[1]) : `report.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMsg('완료')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '실패')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader title="결과 리포트 내려받기" hint="절차 증빙형 납품물 (합의점·쟁점·소수의견·원자료 연결)" />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">
          라운드별 합의점·쟁점·소수의견과 원자료(집계)를 연결한 납품 리포트를 내려받습니다. 개인 투표 원자료는 포함되지 않습니다.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="accent" disabled={busy !== null} onClick={() => download('md')}>{busy === 'md' ? '생성 중…' : 'Markdown'}</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => download('html')}>{busy === 'html' ? '생성 중…' : 'HTML'}</Button>
          <Button size="sm" disabled={busy !== null} onClick={() => download('xlsx')}>{busy === 'xlsx' ? '생성 중…' : 'Excel'}</Button>
          {msg ? <span className="text-[11px] text-textDim">{msg}</span> : null}
        </div>
      </div>
    </Card>
  )
}

function TranscriptLensPanel({ data }: { data: TranscriptLensData | undefined }) {
  const mode = data?.mode ?? 'statement_preview'
  const segments = data?.segments ?? []
  const keywords = data?.keywords ?? []
  const groupActivity = data?.groupActivity ?? []
  const pulse = data?.pulse ?? { questions: 0, agreements: 0, disagreements: 0, concerns: 0 }
  const coverage = data?.coverage
  const lastUpdated = coverage?.lastUpdatedAt ? new Date(coverage.lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '대기'

  return (
    <Card>
      <CardHeader
        title="라이브 전사 렌즈"
        hint={mode === 'transcript' ? `소스 ${coverage?.sourceCount ?? 0}개 · 전사 ${coverage?.segmentCount ?? 0}개` : `전사 미연결 · 제출 발언 ${coverage?.segmentCount ?? 0}개`}
      />
      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={mode === 'transcript' ? 'accent' : 'warn'}>{data?.modeLabel ?? '전사 미연결 프리뷰'}</Badge>
          <Badge tone={data?.recording?.active ? 'info' : 'neutral'}>{data?.recording?.active ? '녹음 동의 ON' : '녹음 동의 OFF'}</Badge>
          {data?.activeRound ? <Badge tone="neutral">라운드 {data.activeRound.roundIndex}</Badge> : <Badge tone="neutral">라운드 없음</Badge>}
          <span className="text-[11px] text-textMute">업데이트 {lastUpdated}</span>
        </div>

        {mode === 'statement_preview' ? (
          <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-textDim">
            실제 음성 전사 수집이 연결되기 전이라, 현재 화면은 참가자 제출 발언을 전사 흐름처럼 시각화한 프리뷰입니다.
          </div>
        ) : null}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)] gap-4">
          <div className="rounded-md border border-border bg-bg">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-medium text-text">최근 전사 흐름</span>
              <span className="text-[11px] text-textMute">{coverage?.visibleSegmentCount ?? segments.length}개 표시</span>
            </div>
            <ol className="divide-y divide-border max-h-[360px] overflow-auto">
              {segments.length === 0 ? (
                <li className="px-3 py-8 text-sm text-textDim text-center">표시할 전사 또는 제출 발언이 없습니다.</li>
              ) : (
                segments.slice().reverse().map((s) => (
                  <li key={s.id} className="px-3 py-2 grid grid-cols-[72px_minmax(0,1fr)] gap-3">
                    <div className="text-[11px] text-textMute tabular-nums">
                      <div>{formatMs(s.startedMs)}</div>
                      <div className="truncate text-textDim">{s.speakerTag || 'speaker'}</div>
                    </div>
                    <p className="text-sm text-text break-words leading-relaxed">{s.text}</p>
                  </li>
                ))
              )}
            </ol>
          </div>

          <div className="space-y-3">
            <div className="rounded-md border border-border bg-bg p-3">
              <div className="text-xs font-medium text-text mb-2">대화 신호</div>
              <div className="grid grid-cols-2 gap-2">
                <SignalTile label="질문" value={pulse.questions} toneClass="bg-info" />
                <SignalTile label="동의" value={pulse.agreements} toneClass="bg-accent" />
                <SignalTile label="반대" value={pulse.disagreements} toneClass="bg-danger" />
                <SignalTile label="우려" value={pulse.concerns} toneClass="bg-warn" />
              </div>
            </div>

            <div className="rounded-md border border-border bg-bg p-3">
              <div className="text-xs font-medium text-text mb-2">키워드</div>
              {keywords.length === 0 ? (
                <p className="text-xs text-textMute">아직 키워드가 없습니다.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((k) => (
                    <span key={k.term} className="inline-flex items-center gap-1 rounded border border-border bg-surfaceAlt px-2 py-1 text-xs text-textDim">
                      <span>{k.term}</span>
                      <span className="text-[10px] text-textMute">{k.count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-border bg-bg p-3">
              <div className="text-xs font-medium text-text mb-2">그룹 발화량</div>
              <ul className="space-y-2">
                {groupActivity.length === 0 ? <li className="text-xs text-textMute">그룹 정보가 없습니다.</li> : null}
                {groupActivity.map((g) => {
                  const pct = Math.round(g.share * 100)
                  return (
                    <li key={g.groupId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-text truncate">{g.label}</span>
                        <span className="text-textDim tabular-nums">{g.segmentCount}개 · {pct}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-surfaceAlt overflow-hidden">
                        <div className="h-full bg-info transition-all" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SignalTile({ label, value, toneClass }: { label: string; value: number; toneClass: string }) {
  return (
    <div className="rounded border border-border bg-surfaceAlt px-2 py-2 min-h-[56px]">
      <div className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${toneClass}`} />
        <span className="text-[11px] text-textDim">{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold text-text tabular-nums">{value}</div>
    </div>
  )
}

function formatMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// ── Q2 검토 후보 패널 (DELIBERATION-QUALITY-PLAN §2 Q2)
// moderation 큐와 **구조적·시각적으로 분리**한다 — 품질 피드백이 제재로 보이면 안 된다(§3).
// 참가자 화면·프로젝터에는 절대 렌더되지 않는다. 승인한 항목만 납품 리포트에 실린다.
const AI_KIND_LABEL: Record<string, string> = {
  evidence_check: '근거 확인 필요',
  definition_mismatch: '용어 정의 불일치'
}

function AiReviewPanel({
  view,
  busy,
  onCompute,
  onReview
}: {
  view: AiObservationView | undefined
  busy: boolean
  onCompute: () => Promise<boolean>
  onReview: (observationId: string, decision: 'approve' | 'reject', reason: string) => Promise<boolean>
}) {
  const pending = view?.pending ?? []
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [working, setWorking] = useState(false)

  return (
    <Card>
      <CardHeader
        title="검토 후보 (리포트용)"
        hint={`대기 ${pending.length} · 승인 ${view?.approvedCount ?? 0} · 기각 ${view?.rejectedCount ?? 0}`}
      />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">
          세션 후 배치로 뽑은 &ldquo;근거 확인이 필요해 보이는 주장&rdquo; 초안입니다. 발언의 옳고 그름을 판정하지 않으며 개인·진영을 지칭하지 않습니다.
          참가자 화면과 프로젝터에는 표시되지 않고, <strong>승인한 항목만</strong> 납품 리포트에 실립니다. 이 패널은 moderation(제재)과 무관합니다.
        </p>
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={busy || working}
            className={MOD_BTN_CLASS}
            onClick={async () => {
              setWorking(true)
              await onCompute()
              setWorking(false)
            }}
          >
            {working ? '분석 중…' : '검토 후보 생성'}
          </Button>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-textDim">검토 대기 중인 후보가 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {pending.map((o) => (
              <li key={o.id} className="rounded-md border border-border bg-bg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Badge tone="info">{AI_KIND_LABEL[o.kind] ?? o.kind}</Badge>
                  <span className="text-[11px] text-textMute">AI 초안 · 승인 전</span>
                </div>
                <p className="text-sm text-text break-words">{o.statementBody}</p>
                <p className="text-xs text-textDim break-words">{o.body}</p>
                {o.suggestedQuestion ? (
                  <p className="text-xs text-text break-words">제안 질문: {o.suggestedQuestion}</p>
                ) : null}
                <label className="block">
                  <span className="block text-[11px] text-textMute mb-1">기각 사유 <span className="text-textMute">(선택)</span></span>
                  <Input
                    value={reasons[o.id] ?? ''}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [o.id]: e.target.value }))}
                    placeholder="예: 이미 근거가 제시된 주장"
                    disabled={busy}
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    className={MOD_BTN_CLASS}
                    onClick={() => onReview(o.id, 'reject', reasons[o.id] ?? '')}
                  >
                    기각
                  </Button>
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={busy}
                    className={MOD_BTN_CLASS}
                    onClick={() => onReview(o.id, 'approve', reasons[o.id] ?? '')}
                  >
                    승인 (리포트에 싣기)
                  </Button>
                </div>
                <div className="text-[11px] text-textMute">원자료: statementId={o.statementId}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

// ── Q1 근거 유형 분포 패널 (DELIBERATION-QUALITY-PLAN §2 Q1)
// 참가자 자기 태깅의 집계만 본다 — AI 판정이 아니므로 "틀린 지적"이 발생하지 않는다.
// 개인 단위는 표시하지 않는다. 기여자 3명 미만 그룹은 서버에서 이미 억제되어 내려온다.
// 프로젝터에는 넣지 않는다 (참가자 대면 압박 방지) — 이 패널은 퍼실리테이터 전용이다.
const EVIDENCE_LABELS: Array<{ key: 'experience' | 'source' | 'estimate' | 'unspecified'; label: string; barClass: string }> = [
  { key: 'experience', label: '경험', barClass: 'bg-accent' },
  { key: 'source', label: '자료·출처', barClass: 'bg-info' },
  { key: 'estimate', label: '추정', barClass: 'bg-warn' },
  { key: 'unspecified', label: '미지정', barClass: 'bg-textMute' }
]

function EvidenceBars({ dist }: { dist: EvidenceKindDistribution }) {
  if (dist.suppressed) {
    const reason = dist.suppressionReason === 'small_cell'
      ? '작은 셀'
      : dist.suppressionReason === 'group_residual'
        ? '그룹 잔차'
        : dist.suppressionReason === 'complementary'
          ? '보완 억제'
          : '표본 부족'
    return (
      <p className="text-xs text-textMute">
        {reason}(기여자 {dist.contributors}명) — 개인 태깅 역추론 방지를 위해 분포를 표시하지 않습니다.
      </p>
    )
  }
  if (dist.total === 0) return <p className="text-xs text-textMute">집계 대상 발언이 없습니다.</p>
  return (
    <ul className="space-y-1">
      {EVIDENCE_LABELS.map((o) => {
        const count = dist.counts[o.key]
        const ratioPct = Math.round(dist.ratios[o.key] * 100)
        return (
          <li key={o.key} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 text-textDim">{o.label}</span>
            <span className="flex-1 h-2 rounded-full bg-surfaceAlt overflow-hidden">
              <span className={`block h-full ${o.barClass}`} style={{ width: `${ratioPct}%` }} />
            </span>
            {/* 색만으로 구분되지 않도록 수치를 항상 함께 표기 */}
            <span className="w-24 shrink-0 text-right text-textDim">{count}건 · {ratioPct}%</span>
          </li>
        )
      })}
    </ul>
  )
}

function EvidencePanel({
  breakdowns,
  rounds,
  groups
}: {
  breakdowns: EvidenceKindRoundBreakdown[]
  rounds: Round[]
  groups: GroupView[]
}) {
  const roundLabel = (roundId: string | null) => {
    if (roundId == null) return '라운드 미지정'
    const r = rounds.find((x) => x.id === roundId)
    return r ? `라운드 ${r.round_index} — ${r.title || '(제목 없음)'}` : `라운드 (${roundId})`
  }
  const groupLabel = (groupId: string) => groups.find((g) => g.id === groupId)?.label ?? groupId

  return (
    <Card>
      <CardHeader title="근거 유형 분포" hint="참가자 자기 태깅 · 그룹 단위" />
      <div className="p-4 space-y-4">
        <p className="text-xs text-textMute">
          참가자가 스스로 고른 근거 유형입니다. 시스템이 발언을 판정하지 않으므로 오탐이 없습니다.
          개인 단위는 표시하지 않으며 기여자 3명 미만 그룹은 억제됩니다. 프로젝터에는 표시되지 않습니다.
        </p>
        {breakdowns.length === 0 ? (
          <p className="text-sm text-textDim">아직 집계할 발언이 없습니다.</p>
        ) : (
          breakdowns.map((b) => (
            <div key={b.roundId ?? '(none)'} className="rounded-md border border-border bg-bg p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{roundLabel(b.roundId)}</span>
                <Badge tone="neutral">발언 {b.overall.suppressed ? '표본 부족' : `${b.overall.total}건`}</Badge>
              </div>
              <div>
                <div className="text-xs text-textDim mb-1">라운드 전체</div>
                <EvidenceBars dist={b.overall} />
              </div>
              {b.byGroup.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs text-textDim">그룹별</div>
                  {b.byGroup.map((g) => (
                    <div key={g.groupId} className="rounded border border-border p-2">
                      <div className="text-xs text-text mb-1">{groupLabel(g.groupId)}</div>
                      <EvidenceBars dist={g.distribution} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function AppSubmissionPanel({
  breakdowns,
  rounds,
  groups
}: {
  breakdowns: AppSubmissionRoundDistribution[]
  rounds: Round[]
  groups: GroupView[]
}) {
  const roundLabel = (roundId: string | null) => {
    if (roundId == null) return '라운드 미지정'
    const r = rounds.find((x) => x.id === roundId)
    return r ? `라운드 ${r.round_index} — ${r.title || '(제목 없음)'}` : `라운드 (${roundId})`
  }
  const groupLabel = (groupId: string) => groups.find((g) => g.id === groupId)?.label ?? groupId

  return (
    <Card>
      <CardHeader title="앱 제출 분포" hint="텍스트 제출 기준 · 그룹 단위" />
      <div className="p-4 space-y-4">
        <p className="text-xs text-textMute">
          앱 또는 운영자 대리 입력으로 저장된 텍스트 제출만 셉니다. 구두 발언은 측정되지 않습니다.
          개인별 제출 여부는 표시하지 않으며, 저자 미상 대리입력이 있는 라운드는 분포를 표시하지 않습니다.
        </p>
        {breakdowns.length === 0 ? (
          <p className="text-sm text-textDim">아직 집계할 제출이 없습니다.</p>
        ) : (
          breakdowns.map((b) => (
            <div key={b.roundId ?? '(none)'} className="rounded-md border border-border bg-bg p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{roundLabel(b.roundId)}</span>
                {b.suppressed ? <Badge tone="warn">대리입력 억제</Badge> : <Badge tone="neutral">{b.groups.length}개 그룹</Badge>}
              </div>
              {b.suppressed ? (
                <p className="text-xs text-textMute">
                  저자 미상 대리입력이 섞여 조용한 참가자를 미제출자로 오분류할 수 있어 라운드 전체 분포를 표시하지 않습니다.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {b.groups.map((g) => (
                    <AppSubmissionGroupBars key={g.groupId} group={g} label={groupLabel(g.groupId)} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

function AppSubmissionGroupBars({ group, label }: { group: AppSubmissionGroupDistribution; label: string }) {
  if (group.suppressed) {
    const reason = group.suppressionReason === 'members' ? '그룹 인원 부족' : group.suppressionReason === 'submitters' ? '제출자 표본 부족' : '대리입력 억제'
    return (
      <div className="rounded border border-border p-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-text">{label}</span>
          <Badge tone="warn">{reason}</Badge>
        </div>
        <p className="mt-2 text-xs text-textMute">개인 제출 여부 역추론 방지를 위해 수치를 표시하지 않습니다.</p>
      </div>
    )
  }
  const ratioPct = Math.round(group.submissionRatio * 100)
  return (
    <div className="rounded border border-border p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-text">{label}</span>
        <span className="text-[11px] text-textDim">{group.submittedParticipants}/{group.memberCount}명 · 제출 {group.statementCount}건</span>
      </div>
      <div className="mt-2 h-2 w-full rounded-full bg-surfaceAlt overflow-hidden" aria-label={`${label} 앱 제출 분포`}>
        <div className="h-full bg-info transition-all" style={{ width: `${ratioPct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-textDim text-right">{ratioPct}%</div>
    </div>
  )
}

function GroupBoard({ groups }: { groups: GroupView[] }) {
  return (
    <Card>
      <CardHeader title="그룹 보드" hint={`${groups.length}개 그룹`} />
      <div className="p-4">
        {groups.length === 0 ? (
          <p className="text-sm text-textDim">배정된 그룹이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {groups.map((g) => (
              <div key={g.id} className="rounded-md border border-border bg-bg p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-text">{g.label}</span>
                  <Badge tone="neutral">{g.members.length}명</Badge>
                </div>
                {g.topic ? <div className="text-xs text-textMute mt-0.5 truncate">{g.topic}</div> : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  {g.members.map((m) => (
                    <span key={m.participantId} className="inline-flex items-center rounded bg-surfaceAlt px-1.5 py-0.5 text-[11px] text-textDim border border-border">
                      {m.alias}
                    </span>
                  ))}
                  {g.members.length === 0 ? <span className="text-[11px] text-textMute">멤버 없음</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

type ModAction = 'flag' | 'hide' | 'restore'

function moderationButtons(state: StatementCard['moderationState']): { action: ModAction; label: string; variant: 'default' | 'danger' | 'accent' }[] {
  // 전이표(repo)와 일치: visible→flag/hide, flagged→hide/restore, hidden→restore.
  if (state === 'visible') return [{ action: 'flag', label: '신고', variant: 'default' }, { action: 'hide', label: '숨김', variant: 'danger' }]
  if (state === 'flagged') return [{ action: 'hide', label: '숨김', variant: 'danger' }, { action: 'restore', label: '복원', variant: 'accent' }]
  return [{ action: 'restore', label: '복원', variant: 'accent' }]
}

function ModerationQueue({
  queue,
  busy,
  onModerate
}: {
  queue: StatementCard[]
  busy: boolean
  onModerate: (statementId: string, action: ModAction) => void
}) {
  return (
    <Card>
      <CardHeader title="Moderation 큐" hint={`${queue.length}건`} />
      <ul className="divide-y divide-border">
        {queue.length === 0 ? <li className="px-4 py-6 text-sm text-textDim text-center">신고/숨김 대기 항목이 없습니다.</li> : null}
        {queue.map((s) => (
          <li key={s.id} className="px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Badge tone={s.moderationState === 'flagged' ? 'warn' : 'danger'}>{s.moderationState === 'flagged' ? '신고됨' : '숨김'}</Badge>
              <p className="text-sm text-text break-words mt-1">{s.body}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              {moderationButtons(s.moderationState).map((b) => (
                <Button key={b.action} size="sm" variant={b.variant} disabled={busy} onClick={() => onModerate(s.id, b.action)} className={MOD_BTN_CLASS}>{b.label}</Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// N4: moderation(파괴적 포함) 버튼 최소 터치 타겟 44×44px + 키보드 포커스 링.
const MOD_BTN_CLASS = 'min-h-[44px] min-w-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

function StatementList({
  statements,
  busy,
  onModerate
}: {
  statements: StatementCard[]
  busy: boolean
  onModerate: (statementId: string, action: ModAction) => void
}) {
  return (
    <Card>
      <CardHeader title="전체 발언" hint={`${statements.length}건`} />
      <ul className="divide-y divide-border">
        {statements.length === 0 ? <li className="px-4 py-6 text-sm text-textDim text-center">아직 발언이 없습니다.</li> : null}
        {statements.map((s) => (
          <li key={s.id} className="px-4 py-3 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-text break-words min-w-0">{s.body}</p>
              <div className="flex shrink-0 gap-1">
                {moderationButtons(s.moderationState).map((b) => (
                  <Button key={b.action} size="sm" variant={b.variant} disabled={busy} onClick={() => onModerate(s.id, b.action)} className={MOD_BTN_CLASS}>{b.label}</Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-textDim">
              <span>찬 {s.tally.agree}</span>
              <span>반 {s.tally.disagree}</span>
              <span>유보 {s.tally.pass}</span>
              <span className="text-textMute">· 총 {s.total}표</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ProxyInput({
  sessionId,
  members,
  statements,
  activeRoundId,
  busy,
  onSubmit,
  onVote
}: {
  sessionId: string
  members: Member[]
  statements: StatementCard[]
  activeRoundId: string | null
  busy: boolean
  onSubmit: (input: unknown) => Promise<boolean>
  onVote: (input: unknown) => Promise<boolean>
}) {
  const [participantId, setParticipantId] = useState('')
  const [body, setBody] = useState('')

  return (
    <Card>
      <CardHeader title="오프라인 대리 입력" hint="종이 제출을 운영자가 대신 입력" />
      <div className="p-4 space-y-3">
        <p className="text-xs text-textMute">
          폰이 없는 참가자의 종이 제출을 대신 입력합니다. 운영자 신원(instructor)으로 기록되어 감사 로그에서 대리입력으로 구분됩니다.
        </p>
        <label className="block">
          <span className="block text-xs text-textDim mb-1">대상 참가자</span>
          <Select value={participantId} onChange={(e) => setParticipantId(e.target.value)}>
            <option value="">참가자 선택</option>
            {members.map((m) => <option key={m.participantId} value={m.participantId}>{m.alias}</option>)}
          </Select>
        </label>

        <div className="space-y-2">
          <label htmlFor="proxy-statement" className="block text-xs text-textDim">의견 대리 제출</label>
          <Textarea id="proxy-statement" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="종이에 적힌 의견을 입력" disabled={busy} />
          <p className="text-xs text-textMute">
            대리입력은 참가자 본인의 근거 유형 선택으로 볼 수 없어 근거 분포 집계에는 미지정으로 처리됩니다.
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="accent"
              disabled={busy || !participantId || !body.trim()}
              onClick={async () => {
                const ok = await onSubmit({
                  sessionId,
                  roundId: activeRoundId ?? undefined,
                  authorParticipantId: participantId,
                  body: body.trim(),
                  visibility: 'group'
                })
                if (ok) setBody('')
              }}
            >
              대리 제출
            </Button>
          </div>
        </div>

        {statements.length > 0 && participantId ? (
          <div className="space-y-2">
            <div className="text-xs text-textDim">의견별 대리 투표</div>
            <ul className="divide-y divide-border border-t border-border">
              {statements.map((s) => (
                <li key={s.id} className="py-2 space-y-1">
                  <p className="text-sm text-text break-words">{s.body}</p>
                  <VoteControls
                    idBase={`proxy-vote-${s.id}`}
                    onVote={(v: VoteValue) => onVote({ statementId: s.id, participantId, vote: v })}
                    disabled={busy}
                  />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
