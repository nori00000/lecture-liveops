'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { swrFetcher } from '@/lib/api/fetcher'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Input, PageHeader, Tabs, Textarea } from '@/components/ui/primitives'
import { formatTimeKo } from '@/lib/util/koreanTime'

type Data = {
  ok: boolean
  role?: string
  session?: { id: string; title: string; date: string }
  qna?: { id: string; body: string; status: string }[]
  practice?: { id: string; body: string; status: string }[]
  resources?: { id: string; title: string; url_or_storage_path: string; type: string }[]
  announcements?: { id: string; body: string; created_at: string; type: string }[]
  error?: string
}

export default function ParticipantDashboardPage() {
  const router = useRouter()
  const { data, mutate } = useSWR<Data>('/api/data/participant/session', swrFetcher, { refreshInterval: 3000 })
  const [tab, setTab] = useState<'qna' | 'practice' | 'resources' | 'notice'>('qna')
  const [body, setBody] = useState('')
  const [pBody, setPBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (data?.ok === false) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
        <Card className="max-w-md w-full p-6 text-center">
          <div className="text-xl font-semibold mb-2">참가자 세션이 필요합니다</div>
          <p className="text-sm text-textDim mb-4">접속 키를 다시 입력해 주세요.</p>
          <Button variant="accent" onClick={() => router.replace('/p/enter')}>접속 키 입력</Button>
        </Card>
      </main>
    )
  }

  async function addQ() {
    if (!data?.session || !body.trim()) return
    try {
      const res = await invoke({ action: 'liveops.add_qna', role: 'participant', scope: { sessionId: data.session.id }, input: { sessionId: data.session.id, body } })
      if (!res?.ok) {
        setError(`질문 전송에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setBody('')
      mutate()
    } catch {
      setError('질문 전송 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  async function addP() {
    if (!data?.session || !pBody.trim()) return
    try {
      const res = await invoke({ action: 'liveops.create_practice_ticket', role: 'participant', scope: { sessionId: data.session.id }, input: { sessionId: data.session.id, body: pBody } })
      if (!res?.ok) {
        setError(`도움 요청 전송에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setPBody('')
      mutate()
    } catch {
      setError('도움 요청 전송 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  return (
    <main className="min-h-screen bg-bg text-text">
      <div className="max-w-2xl mx-auto p-6">
        <PageHeader
          title="강의 참가자 페이지"
          desc={data?.session ? `${data.session.title} · ${data.session.date}` : ''}
          right={<Badge tone="info">{data?.role ?? 'participant'}</Badge>}
        />
        <Tabs
          active={tab}
          onChange={(id) => setTab(id as typeof tab)}
          tabs={[
            { id: 'qna', label: '질문' },
            { id: 'practice', label: '실습 도움' },
            { id: 'resources', label: '자료' },
            { id: 'notice', label: '공지' }
          ]}
        />
        {error ? (
          <div role="status" className="mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </div>
        ) : null}
        <div className="mt-4 space-y-4">
          {tab === 'qna' ? (
            <>
              <Card className="p-3 flex gap-2">
                <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="궁금한 점을 입력하세요" />
                <Button variant="accent" onClick={addQ}>질문 보내기</Button>
              </Card>
              <Card>
                <CardHeader title="내가 보낸 질문 흐름" />
                <ul className="divide-y divide-border">
                  {(data?.qna ?? []).map((q) => (
                    <li key={q.id} className="px-4 py-2 flex gap-2 items-center">
                      <Badge tone={q.status === 'answered' ? 'accent' : 'neutral'}>{q.status}</Badge>
                      <span className="text-sm">{q.body}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
          {tab === 'practice' ? (
            <>
              <Card className="p-3">
                <Textarea value={pBody} onChange={(e) => setPBody(e.target.value)} rows={2} placeholder="막힌 부분을 설명해 주세요" />
                <div className="flex justify-end mt-2">
                  <Button variant="accent" onClick={addP}>도움 요청</Button>
                </div>
              </Card>
              <Card>
                <CardHeader title="실습 티켓" />
                <ul className="divide-y divide-border">
                  {(data?.practice ?? []).map((p) => (
                    <li key={p.id} className="px-4 py-2 flex gap-2 items-center">
                      <Badge tone={p.status === 'solved' ? 'accent' : 'warn'}>{p.status}</Badge>
                      <span className="text-sm">{p.body}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          ) : null}
          {tab === 'resources' ? (
            <Card>
              <CardHeader title="공유 자료" />
              <ul className="divide-y divide-border">
                {(data?.resources ?? []).map((r) => (
                  <li key={r.id} className="px-4 py-2 flex items-center justify-between">
                    <a href={r.url_or_storage_path} target="_blank" rel="noreferrer noopener" className="text-sm hover:text-accent">{r.title}</a>
                    <Badge tone="neutral">{r.type}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {tab === 'notice' ? (
            <Card>
              <CardHeader title="공지" />
              <ul className="divide-y divide-border">
                {(data?.announcements ?? []).map((a) => (
                  <li key={a.id} className="px-4 py-2 flex gap-3 items-center">
                    <span className="text-xs text-textMute w-16">{formatTimeKo(a.created_at)}</span>
                    <Badge tone="neutral">{a.type}</Badge>
                    <span className="text-sm">{a.body}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </main>
  )
}
