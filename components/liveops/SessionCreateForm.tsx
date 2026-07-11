'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Card, CardHeader, Input } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api/fetcher'
import { BOARD_COOKIE } from '@/lib/liveops/board-cookie'

export function SessionCreateForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    companyName: '',
    title: '',
    date: '',
    venue: '',
    category: '',
    mainInstructor: '',
    currentPhase: '강의 준비'
  })
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!form.companyName.trim()) {
      setMessage('기업명을 입력하세요 — 실제 회사 연결에 필요합니다')
      return
    }
    setBusy(true)
    setMessage('세션 생성 중...')
    try {
      const res = await apiFetch('/api/action', {
        method: 'POST',
        body: JSON.stringify({
          action: 'liveops.create_lecture_session',
          actor: { type: 'human', role: 'instructor', tool: 'web-ui' },
          scope: {},
          idempotencyKey: `session-${Date.now()}`,
          redactionPolicy: 'summary',
          dryRun: false,
          input: {
            ...form,
            title: form.title || '새 기업 강의 세션',
            // KST 기준 오늘 — toISOString은 UTC라 한국 아침에 전날 날짜가 된다
            date: form.date || new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
            category: form.category || '기업 AX 교육'
          }
        })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      const sessionId = typeof data.data?.id === 'string' ? data.data.id : ''
      if (!sessionId) throw new Error('세션 ID 누락')
      document.cookie = `${BOARD_COOKIE}=${encodeURIComponent(sessionId)}; path=/; max-age=${60 * 60 * 12}; samesite=lax`
      router.push(`/today?sessionId=${encodeURIComponent(sessionId)}`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '생성 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="날짜별 기업 강의 세션 생성" hint="LLM 정리 대시보드 시작점" />
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input placeholder="기업명" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        <Input placeholder="강의 제목" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <Input placeholder="장소" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
        <Input placeholder="교육 카테고리" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
        <Input placeholder="메인 강사" value={form.mainInstructor} onChange={(e) => setForm({ ...form, mainInstructor: e.target.value })} />
        <Input className="md:col-span-2" placeholder="현재 단계" value={form.currentPhase} onChange={(e) => setForm({ ...form, currentPhase: e.target.value })} />
        <div className="md:col-span-2 flex items-center justify-between gap-3">
          <p className="text-xs text-textMute">생성 후 세션별 상황판으로 이동합니다.</p>
          <Button variant="accent" onClick={submit} disabled={busy}>{busy ? '생성 중' : '세션 만들기'}</Button>
        </div>
        {message ? <p className="md:col-span-2 text-xs text-textDim">{message}</p> : null}
      </div>
    </Card>
  )
}
