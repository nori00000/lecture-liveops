'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Input, Modal, PageHeader, Select } from '@/components/ui/primitives'

type Q = { id: string; body: string; answer: string | null; status: string; priority: string; tags?: string[] }

const COLUMNS: { id: Q['status']; label: string }[] = [
  { id: 'new', label: '신규' },
  { id: 'triaged', label: '분류됨' },
  { id: 'answered', label: '답변 완료' },
  { id: 'needs_follow_up', label: '팔로업 필요' },
  { id: 'sent_to_company', label: '회사 전달' }
]

export default function QnaPage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; qna?: Q[] }>('/api/data/session')
  const session = data?.session
  const [modal, setModal] = useState(false)
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [error, setError] = useState<string | null>(null)

  // 운영 콘솔 페이지이므로 participant가 아니라 assistant role로 invoke한다 (seatmap/playbook과 동일 패턴).
  async function add() {
    if (!session || !body.trim()) return
    try {
      const res = await invoke({ action: 'liveops.add_qna', role: 'assistant', scope: { sessionId: session.id }, input: { sessionId: session.id, body, priority } })
      if (!res?.ok) {
        setError(`질문 등록에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      setBody('')
      setModal(false)
      mutate()
    } catch {
      setError('질문 등록 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  async function answer(q: Q) {
    const ans = window.prompt('답변 입력', q.answer ?? '')
    if (!ans) return
    try {
      const res = await invoke({ action: 'liveops.answer_qna', role: 'instructor', scope: { sessionId: session!.id }, input: { qnaId: q.id, answer: ans, status: 'answered' } })
      if (!res?.ok) {
        setError(`답변 저장에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      mutate()
    } catch {
      setError('답변 저장 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  async function move(q: Q, status: Q['status']) {
    try {
      const res = await invoke({ action: 'liveops.update_qna_status', role: 'assistant', scope: { sessionId: session!.id }, input: { qnaId: q.id, status } })
      if (!res?.ok) {
        setError(`상태 변경에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      mutate()
    } catch {
      setError('상태 변경 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  async function remove(q: Q) {
    if (!session) return
    const ok = window.confirm('이 질문을 삭제할까요? 삭제 후에는 질문답변 목록에서 사라집니다.')
    if (!ok) return
    try {
      const res = await invoke({ action: 'liveops.delete_qna', role: 'assistant', scope: { sessionId: session.id }, input: { qnaId: q.id } })
      if (!res?.ok) {
        setError(`질문 삭제에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      mutate()
    } catch {
      setError('질문 삭제 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.')
    }
  }

  return (
    <div className="p-6">
      <PageHeader
        title="질문답변"
        desc="신규부터 회사 전달까지 5단계 칸반"
        right={<Button variant="accent" onClick={() => setModal(true)}>질문 추가</Button>}
      />
      {error ? (
        <div role="status" className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const items = (data?.qna ?? []).filter((q) => q.status === col.id)
          return (
            <Card key={col.id} className="flex flex-col">
              <CardHeader title={col.label} hint={`${items.length}건`} />
              <ul className="p-2 space-y-2 min-h-[200px]">
                {items.map((q) => (
                  <li key={q.id} className="bg-surfaceAlt border border-border rounded p-2.5">
                    <div className="text-sm">{q.body}</div>
                    {q.answer ? <div className="text-xs text-textDim mt-1.5">답변: {q.answer}</div> : null}
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-1.5">
                        {q.tags?.includes('transcript') ? <Badge tone="accent">transcript</Badge> : null}
                        <Badge tone={q.priority === 'high' ? 'danger' : q.priority === 'low' ? 'neutral' : 'info'}>
                          {q.priority}
                        </Badge>
                      </div>
                      <div className="flex gap-1">
                        {col.id !== 'answered' && col.id !== 'sent_to_company' ? (
                          <Button size="sm" variant="accent" onClick={() => answer(q)}>답변</Button>
                        ) : null}
                        <Select value={q.status} onChange={(e) => move(q, e.target.value as Q['status'])}>
                          {COLUMNS.map((c) => (
                            <option key={c.id} value={c.id}>{c.label}</option>
                          ))}
                        </Select>
                        <Button size="sm" variant="danger" onClick={() => remove(q)}>삭제</Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )
        })}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="질문 추가">
        <div className="space-y-3">
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="질문 본문" />
          <Select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </Select>
          {error ? (
            <div role="status" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setModal(false)}>취소</Button>
            <Button variant="accent" onClick={add}>등록</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
