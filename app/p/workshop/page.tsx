'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { swrFetcher } from '@/lib/api/fetcher'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Textarea, PageHeader } from '@/components/ui/primitives'
import { VoteControls } from '@/components/delib/VoteControls'
import { EvidenceKindControls } from '@/components/delib/EvidenceKindControls'
import { RecordingBanner } from '@/components/delib/RecordingBanner'
import type { VoteValue, EvidenceKind } from '@/lib/db/schema'

type StatementCard = {
  id: string
  body: string
  groupId: string | null
  roundId: string | null
  moderationState: string
  createdAt: string
}

type Data = {
  ok: boolean
  error?: string
  session?: { id: string; title: string; date: string }
  participantId?: string
  myGroupId?: string | null
  activeRound?: { id: string; title: string; mode: string; roundIndex: number } | null
  canSubmit?: boolean
  myStatements?: StatementCard[]
  votable?: StatementCard[]
  myVotes?: Record<string, VoteValue>
  participantCount?: number
  anonymity?: { available: boolean; minParticipants: number }
  recording?: { active: boolean; consentAt: string | null }
  miniLens?: {
    segmentCount: number
    openQuestionCount: number
    evidenceWaitingCount: number
    definitionCheckCount: number
    nudges: Array<{ id: string; kind: string; label: string; prompt: string }>
  }
}

// 참가자용 폴링: 개별 폰 결과는 저부하 원칙(§3, N3)에 맞춰 12초 간격.
// 투표/제출 직후에는 mutate()로 즉시 최신화한다.
const POLL_MS = 12000

export default function ParticipantWorkshopPage() {
  const router = useRouter()
  const { data, mutate } = useSWR<Data>('/api/data/delib/participant-view', swrFetcher, { refreshInterval: POLL_MS })
  const [body, setBody] = useState('')
  // Q1: 근거 유형 자기 태깅. 기본값 없음(null) — 강제하지 않는다.
  const [evidenceKind, setEvidenceKind] = useState<EvidenceKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // N2: statement 별 투표 진행 중 표시 — 연타/레이스 방지(pending 중 재클릭 disable).
  const [pendingVotes, setPendingVotes] = useState<Set<string>>(new Set())
  // N5: 투표/제출 성공을 보조기술에 알리는 aria-live 상태 메시지.
  const [status, setStatus] = useState('')

  if (data?.ok === false) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
        <Card className="max-w-md w-full p-6 text-center">
          <div className="text-xl font-semibold mb-2">워크숍 세션이 필요합니다</div>
          <p className="text-sm text-textDim mb-4">접속 키를 다시 입력해 주세요.</p>
          <Button variant="accent" onClick={() => router.replace('/p/enter')}>접속 키 입력</Button>
        </Card>
      </main>
    )
  }

  const sessionId = data?.session?.id
  const activeRound = data?.activeRound ?? null
  const canSubmit = Boolean(data?.canSubmit && sessionId)
  const votable = data?.votable ?? []
  const myStatements = data?.myStatements ?? []
  const nextParticipantAction = activeRound
    ? '질문에 답하거나, 근거를 이어주거나, 용어의 의미를 맞춰주세요.'
    : '진행자가 라운드를 시작할 때까지 대화 상태를 함께 보고 기다립니다.'

  async function submitStatement() {
    if (!sessionId || !body.trim()) return
    setBusy(true)
    try {
      const res = await invoke({
        action: 'delib.submit_statement',
        role: 'participant',
        scope: { sessionId },
        input: {
          sessionId,
          roundId: activeRound?.id,
          groupId: data?.myGroupId ?? undefined,
          body: body.trim(),
          visibility: 'group',
          // 미선택이면 아예 보내지 않는다 (서버에서 null 로 저장).
          evidenceKind: evidenceKind ?? undefined
        }
      })
      if (!res?.ok) {
        setError(`의견 제출에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setBody('')
      setEvidenceKind(null)
      await mutate()
      setStatus('의견이 제출되었습니다.')
    } catch {
      setError('의견 제출 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function castVote(statementId: string, vote: VoteValue) {
    if (!sessionId) return
    // N2: 이미 진행 중인 statement 는 중복 투표 방지.
    if (pendingVotes.has(statementId)) return
    setPendingVotes((prev) => new Set(prev).add(statementId))
    try {
      const res = await invoke({
        action: 'delib.vote_statement',
        role: 'participant',
        scope: { sessionId },
        input: { statementId, vote }
      })
      if (!res?.ok) {
        setError(`투표에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      // N2: 서버 반영을 기다렸다가(await) 다음 조작을 허용 — 낙관적 상태 어긋남 방지.
      await mutate()
      setStatus('투표가 반영되었습니다.')
    } catch {
      setError('투표 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    } finally {
      setPendingVotes((prev) => {
        const next = new Set(prev)
        next.delete(statementId)
        return next
      })
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <PageHeader
          title="숙의 워크숍"
          desc={data?.session ? `${data.session.title} · ${data.session.date}` : '불러오는 중...'}
          right={data?.myGroupId ? <Badge tone="info">내 그룹 배정됨</Badge> : <Badge tone="neutral">개별 참여</Badge>}
        />

        {/* 녹음·전사 상시 배너 — 동의된 세션에서만 노출 */}
        <RecordingBanner active={data?.recording?.active === true} audience="participant" />

        <ParticipantMiniLens lens={data?.miniLens} activeRound={activeRound} />

        {/* §7-1: 익명 최소 임계 안내 */}
        {data?.anonymity && !data.anonymity.available ? (
          <div role="status" className="mb-4 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
            현재 참가자 {data.participantCount ?? 0}명 — {data.anonymity.minParticipants}명 미만에서는 익명 모드가 사실상
            익명이 되지 않아 비활성됩니다. 기명 또는 무기록 토의로 진행됩니다.
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {/* N5: 투표/제출 성공을 보조기술에 알림 (시각적으로는 sr-only). */}
        <div role="status" aria-live="polite" className="sr-only">{status}</div>

        {/* 현재 라운드 안내 */}
        <Card className="mb-4">
          <CardHeader title="현재 라운드" />
          <div className="p-4">
            {activeRound ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone="accent">라운드 {activeRound.roundIndex}</Badge>
                  <span className="text-sm text-text">{activeRound.title || '(제목 없음)'}</span>
                  <Badge tone="neutral">{activeRound.mode === 'breakout' ? '분임' : '전체'}</Badge>
                </div>
                <p className="text-sm text-textDim">{nextParticipantAction}</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-textDim">아직 진행 중인 라운드가 없습니다.</p>
                <p className="text-xs text-textMute">대기 중에는 제출·투표가 잠시 닫힙니다. 라운드가 시작되면 이 화면이 자동으로 바뀝니다.</p>
              </div>
            )}
          </div>
        </Card>

        {/* 의견 제출 */}
        <Card className="mb-4">
          <CardHeader title="대화에 보태기" hint={canSubmit ? undefined : '라운드 대기 중'} />
          {canSubmit ? (
            <div className="p-4 space-y-2">
              <label htmlFor="delib-statement-input" className="sr-only">의견 입력</label>
              <Textarea
                id="delib-statement-input"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                placeholder="예: 야간 연장이 필요하다면, 어떤 이용자 경험이나 자료가 있나요?"
                disabled={busy}
              />
              {/* Q1: 근거 유형 자기 태깅 — 선택사항, 기본값 없음. 판정이 아니라 본인 표기다. */}
              <div className="pt-1">
                <div className="text-xs text-textDim mb-1">
                  보탠 말의 바탕 <span className="text-textMute">(선택사항 — 고르지 않아도 제출됩니다)</span>
                </div>
                <EvidenceKindControls
                  idBase="evidence-kind"
                  value={evidenceKind}
                  onChange={setEvidenceKind}
                  disabled={busy}
                />
              </div>
              <div className="flex justify-end">
                <Button variant="accent" onClick={submitStatement} disabled={busy || !body.trim()}>
                  {busy ? '제출 중' : '대화에 보태기'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="p-4">
              <div className="rounded-md border border-border bg-bg px-3 py-4">
                <div className="text-sm font-medium text-text">라운드가 시작되면 입력창이 열립니다.</div>
                <p className="mt-1 text-xs leading-relaxed text-textDim">
                  기다리는 동안에는 Room Mirror의 질문·근거·정의 신호를 보고, 말하고 싶은 한 문장을 마음속으로 준비해 주세요.
                </p>
              </div>
            </div>
          )}
        </Card>

        {votable.length > 0 ? (
          <Card className="mb-4">
            <CardHeader title="투표" hint={`${votable.length}건`} />
            <ul className="divide-y divide-border">
              {votable.map((s) => (
                <li key={s.id} className="px-4 py-3 space-y-2">
                  <p className="text-sm text-text break-words">{s.body}</p>
                  <VoteControls
                    idBase={`vote-${s.id}`}
                    value={data?.myVotes?.[s.id]}
                    onVote={(v) => castVote(s.id, v)}
                    disabled={pendingVotes.has(s.id)}
                  />
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {myStatements.length > 0 ? (
          <Card>
            <CardHeader title="내가 낸 의견" hint={`${myStatements.length}건`} />
            <ul className="divide-y divide-border">
              {myStatements.map((s) => (
                <li key={s.id} className="px-4 py-2 flex items-start gap-2">
                  <Badge tone={s.moderationState === 'visible' ? 'accent' : 'warn'}>
                    {s.moderationState === 'visible' ? '게시됨' : s.moderationState === 'flagged' ? '검토중' : '숨김'}
                  </Badge>
                  <span className="text-sm break-words">{s.body}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <div className="rounded-md border border-border bg-surface px-4 py-3 text-xs text-textMute">
            아직 제출·투표 기록이 없습니다. 라운드가 시작되면 이 영역에 내 참여 기록이 쌓입니다.
          </div>
        )}
      </div>
    </main>
  )
}

function ParticipantMiniLens({ lens, activeRound }: { lens: Data['miniLens']; activeRound: Data['activeRound'] }) {
  const nudges = lens?.nudges ?? []
  const primary = nudges[0]
  return (
    <Card className="mb-4">
      <CardHeader title="지금 대화에서 해볼 일" hint={`${lens?.segmentCount ?? 0}개 발언 기준`} />
      <div className="p-4 space-y-3">
        <div className="rounded-md border border-accentDim/40 bg-accentDim/10 px-3 py-3">
          <div className="text-[11px] text-accent">다음 행동</div>
          <p className="mt-1 text-sm leading-relaxed text-text">
            {primary?.prompt ?? (activeRound ? '먼저 한 문장으로 의견을 보태고, 다른 사람의 근거를 이어서 확인해 보세요.' : '라운드가 시작되면 질문·근거·정의 확인 지점이 여기에 표시됩니다.')}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniSignal label="열린 질문" value={lens?.openQuestionCount ?? 0} tone="text-info" />
          <MiniSignal label="근거 이어보기" value={lens?.evidenceWaitingCount ?? 0} tone="text-warn" />
          <MiniSignal label="정의 확인" value={lens?.definitionCheckCount ?? 0} tone="text-accent" />
        </div>
        {nudges.length === 0 ? (
          <p className="rounded border border-border bg-bg px-3 py-4 text-center text-sm text-textDim">
            아직 특정 지점은 없습니다. 지금은 짧게 말하고, 이유를 한 문장 덧붙이면 충분합니다.
          </p>
        ) : (
          <ul className="space-y-2">
            {nudges.map((n) => (
              <li key={n.id} className="rounded border border-border bg-bg p-3">
                <div className="mb-1"><Badge tone={n.kind === 'ask_evidence' ? 'warn' : n.kind === 'define_term' ? 'accent' : 'info'}>{n.label}</Badge></div>
                <p className="text-sm leading-relaxed text-text">{n.prompt}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function MiniSignal({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="min-h-[70px] rounded border border-border bg-bg p-2">
      <div className="text-[11px] leading-tight text-textDim">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}
