'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, Input, PageHeader, Select } from '@/components/ui/primitives'

type R = { id: string; type: string; title: string; url_or_storage_path: string; visibility: string }

const TYPES = ['pdf', 'md', 'xlsx', 'image', 'link', 'html', 'prompt', 'code'] as const
const VIS = ['public', 'session', 'private', 'admin_only'] as const

export default function ResourcesPage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; resources?: R[] }>('/api/data/session')
  const session = data?.session
  const [filter, setFilter] = useState<string>('all')
  const items = (data?.resources ?? []).filter((r) => filter === 'all' || r.visibility === filter)
  const grouped = TYPES.map((t) => ({ type: t, list: items.filter((r) => r.type === t) }))

  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [vis, setVis] = useState<typeof VIS[number]>('session')
  const [err, setErr] = useState('')

  async function addLink() {
    if (!session || !title || !url) return
    try {
      const r = await invoke({
        action: 'liveops.attach_link',
        role: 'instructor',
        scope: { sessionId: session.id },
        input: { sessionId: session.id, url, title, visibility: vis }
      })
      // 실패 시 입력을 지우지 않는다(작성 내용 보존) + 목록 갱신 안 함
      if (r && (r.ok === false || r.error)) {
        setErr('추가 실패 — 다시 시도해 주세요')
        return
      }
      setTitle('')
      setUrl('')
      setErr('')
      mutate()
    } catch {
      setErr('전송 실패 — 연결을 확인해 주세요')
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="자료 보드" desc="유형별 그리드 · 공개범위 필터" />
      <Card className="mb-4 p-3 flex gap-2 flex-wrap items-center">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">전체</option>
          {VIS.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="자료 제목" className="max-w-[200px]" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        <Select value={vis} onChange={(e) => setVis(e.target.value as typeof VIS[number])}>
          {VIS.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Button variant="accent" onClick={addLink}>링크 추가</Button>
        {err ? <span role="status" className="text-xs text-danger">{err}</span> : null}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {grouped.map((g) => (
          <Card key={g.type}>
            <CardHeader title={g.type} hint={`${g.list.length}건`} />
            <ul className="divide-y divide-border">
              {g.list.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm flex items-center justify-between gap-2">
                  <a href={r.url_or_storage_path} target="_blank" rel="noreferrer noopener" className="truncate hover:text-accent">{r.title}</a>
                  <Badge tone={r.visibility === 'admin_only' ? 'danger' : r.visibility === 'public' ? 'accent' : 'neutral'}>{r.visibility}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
