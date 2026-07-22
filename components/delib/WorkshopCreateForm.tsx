'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Card, CardHeader, Input } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api/fetcher'

// 워크숍 생성 = 세션 생성만 수행하고 설정 페이지로 이동한다.
// 라운드 시작(delib.create_workshop)은 설정 페이지의 프라이버시 사전 합의 게이트 통과 후에만 (§7-4).
export function WorkshopCreateForm() {
  const router = useRouter()
  const [form, setForm] = useState({ companyName: '', title: '', date: '', venue: '' })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!form.companyName.trim()) {
      setMessage('주최/기관명을 입력하세요 — 실제 조직 연결에 필요합니다')
      return
    }
    setBusy(true)
    setMessage('워크숍 세션 생성 중...')
    try {
      const res = await apiFetch('/api/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'liveops.create_lecture_session',
          actor: { type: 'human', role: 'instructor', tool: 'web-ui' },
          scope: {},
          idempotencyKey: `workshop-${Date.now()}`,
          redactionPolicy: 'summary',
          dryRun: false,
          input: {
            companyName: form.companyName,
            title: form.title || '숙의 워크숍',
            date: form.date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
            venue: form.venue,
            category: '숙의 워크숍'
          }
        })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const sessionId = typeof data.data?.id === 'string' ? data.data.id : ''
      if (!sessionId) throw new Error('세션 ID 누락')
      router.push(`/workshops/${encodeURIComponent(sessionId)}/settings`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '생성 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="워크숍 세션 만들기" hint="다음 단계: 프라이버시 설정 및 사전 합의" />
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input placeholder="주최/기관명" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <Input placeholder="워크숍 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input placeholder="장소" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        <div className="md:col-span-2 flex items-center justify-between gap-3">
          <p className="text-xs text-textMute">생성 후 설정 페이지에서 사전 합의를 마쳐야 워크숍을 시작할 수 있습니다.</p>
          <Button variant="accent" onClick={submit} disabled={busy}>{busy ? '생성 중' : '다음: 설정'}</Button>
        </div>
        {message ? <p className="md:col-span-2 text-xs text-textDim">{message}</p> : null}
      </div>
    </Card>
  )
}
