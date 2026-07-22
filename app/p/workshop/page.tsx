'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { swrFetcher } from '@/lib/api/fetcher'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Textarea, PageHeader } from '@/components/ui/primitives'
import { VoteControls } from '@/components/delib/VoteControls'
import type { VoteValue } from '@/lib/db/schema'

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
}

// 참가자용 폴링: 라운드/발언은 준수히 반응하되 결과 저부하 원칙(§3)에 맞춰 8초 간격.
// 투표/제출 직후에는 mutate()로 즉시 최신화한다.
const POLL_MS = 8000

export default function ParticipantWorkshopPage() {
  const router = useRouter()
  const { data, mutate } = useSWR<Data>('/api/data/delib/participant-view', swrFetcher, { refreshInterval: POLL_MS })
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

  async function submitStatement() {
    if (!sessionId || !body.trim()) return
    setBusy(true)
    try {
      const res = await invoke({
        action: 'delib.submit_statement',
        role: 'participant',
        scope: { sessionId },
        input: { sessionId, roundId: activeRound?.id, groupId: data?.myGroupId ?? undefined, body: body.trim(), visibility: 'group' }
      })
      if (!res?.ok) {
        setError(`의견 제출에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setBody('')
      mutate()
    } catch {
      setError('의견 제출 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function castVote(statementId: string, vote: VoteValue) {
    if (!sessionId) return
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
      mutate()
    } catch {
      setError('투표 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <PageHeader
          title="숙의 워크숍"
          desc={data?.session ? `${data.session.title} · ${data.session.date}` : '불러오는 중...'}
          right={data?.myGroupId ? <Badge tone="info">내 그룹 배정됨</Badge> : <Badge tone="neutral">그룹 미배정</Badge>}
        />

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

        {/* 현재 라운드 안내 */}
        <Card className="mb-4">
          <CardHeader title="현재 라운드" />
          <div className="p-4">
            {activeRound ? (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="accent">라운드 {activeRound.roundIndex}</Badge>
                <span className="text-sm text-text">{activeRound.title || '(제목 없음)'}</span>
                <Badge tone="neutral">{activeRound.mode === 'breakout' ? '분임' : '전체'}</Badge>
              </div>
            ) : (
              <p className="text-sm text-textDim">진행 중인 라운드가 없습니다. 진행자가 라운드를 시작하면 여기에 표시됩니다.</p>
            )}
          </div>
        </Card>

        {/* 의견 제출 */}
        <Card className="mb-4">
          <CardHeader title="의견 제출" hint={canSubmit ? undefined : '라운드 대기 중'} />
          <div className="p-4 space-y-2">
            <label htmlFor="delib-statement-input" className="sr-only">의견 입력</label>
            <Textarea
              id="delib-statement-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder={canSubmit ? '이 라운드에 대한 의견을 적어주세요' : '라운드가 시작되면 의견을 낼 수 있습니다'}
              disabled={!canSubmit || busy}
            />
            <div className="flex justify-end">
              <Button variant="accent" onClick={submitStatement} disabled={!canSubmit || busy || !body.trim()}>
                {busy ? '제출 중' : '의견 제출'}
              </Button>
            </div>
          </div>
        </Card>

        {/* 투표 대상 목록 */}
        <Card className="mb-4">
          <CardHeader title="투표" hint={`${data?.votable?.length ?? 0}건`} />
          <ul className="divide-y divide-border">
            {(data?.votable ?? []).length === 0 ? (
              <li className="px-4 py-6 text-sm text-textDim text-center">투표할 의견이 아직 없습니다.</li>
            ) : null}
            {(data?.votable ?? []).map((s) => (
              <li key={s.id} className="px-4 py-3 space-y-2">
                <p className="text-sm text-text break-words">{s.body}</p>
                <VoteControls
                  idBase={`vote-${s.id}`}
                  value={data?.myVotes?.[s.id]}
                  onVote={(v) => castVote(s.id, v)}
                />
              </li>
            ))}
          </ul>
        </Card>

        {/* 내가 낸 의견 */}
        <Card>
          <CardHeader title="내가 낸 의견" hint={`${data?.myStatements?.length ?? 0}건`} />
          <ul className="divide-y divide-border">
            {(data?.myStatements ?? []).length === 0 ? (
              <li className="px-4 py-6 text-sm text-textDim text-center">아직 제출한 의견이 없습니다.</li>
            ) : null}
            {(data?.myStatements ?? []).map((s) => (
              <li key={s.id} className="px-4 py-2 flex items-start gap-2">
                <Badge tone={s.moderationState === 'visible' ? 'accent' : 'warn'}>
                  {s.moderationState === 'visible' ? '게시됨' : s.moderationState === 'flagged' ? '검토중' : '숨김'}
                </Badge>
                <span className="text-sm break-words">{s.body}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </main>
  )
}
