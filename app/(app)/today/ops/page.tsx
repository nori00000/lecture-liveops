'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Input, PageHeader, Select } from '@/components/ui/primitives'
import { formatTimeKo } from '@/lib/util/koreanTime'

type Op = { id: string; type: string; body: string; created_at: string }
const TYPES = ['issue', 'mood', 'signal', 'question', 'progress', 'resource', 'note'] as const

export default function OpsPage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; ops?: Op[] }>('/api/data/session')
  const session = data?.session
  const [type, setType] = useState<typeof TYPES[number]>('note')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')

  async function submit() {
    if (!session || !body.trim()) return
    try {
      const r = await invoke({
        action: 'liveops.append_ops_log',
        role: 'assistant',
        scope: { sessionId: session.id },
        input: { sessionId: session.id, logType: type, body, visibility: 'private' }
      })
      // 실패 시 본문을 지우지 않는다(작성 내용 보존)
      if (r && (r.ok === false || r.error)) {
        setErr('기록 실패 — 다시 시도해 주세요')
        return
      }
      setBody('')
      setErr('')
      mutate()
    } catch {
      setErr('전송 실패 — 연결을 확인해 주세요')
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="운영 로그" desc="이슈/분위기/진행/질문/자료/노트를 빠르게 기록" />
      <Card className="mb-4 p-3 flex gap-2 items-center">
        <Select value={type} onChange={(e) => setType(e.target.value as typeof TYPES[number])}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="로그 본문" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        <Button variant="accent" onClick={submit}>기록</Button>
        {err ? <span role="status" className="text-xs text-danger">{err}</span> : null}
      </Card>
      <Card>
        <CardHeader title="시간 역순" hint={`${data?.ops?.length ?? 0}건`} />
        <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto scrollbar-thin">
          {(data?.ops ?? []).map((o) => (
            <li key={o.id} className="px-4 py-2 flex gap-3 items-center">
              <span className="text-xs text-textMute w-20 shrink-0">{formatTimeKo(o.created_at)}</span>
              <Badge tone={o.type === 'issue' ? 'danger' : o.type === 'signal' ? 'warn' : 'neutral'}>{o.type}</Badge>
              <span className="text-sm">{o.body}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
