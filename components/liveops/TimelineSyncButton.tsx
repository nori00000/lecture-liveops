'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Modal } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api/fetcher'

type Planned = { url?: string; chapters?: { id: string; title: string; start: string; end: string }[] }

// 상황판에서 기획 타임라인 링크를 붙여 "기획 vs 실제 진행" 비교를 활성화한다.
// 링크의 챕터·시각을 서버가 파싱해 세션 metadata.plannedTimeline 에 저장한다.
export function TimelineSyncButton({ sessionId, initial }: { sessionId: string; initial?: Planned }) {
  const router = useRouter()
  const [planned, setPlanned] = useState<Planned | undefined>(initial)
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState(initial?.url ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function apply() {
    setBusy(true); setErr('')
    try {
      const res = await apiFetch('/api/timeline-sync', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, url })
      })
      const j = await res.json()
      if (!j.ok) { setErr(j.error ?? '연동 실패'); return }
      setPlanned(j.plannedTimeline); setOpen(false); router.refresh()
    } catch { setErr('네트워크 오류') } finally { setBusy(false) }
  }

  const n = planned?.chapters?.length ?? 0
  const on = n > 0
  const inputCls = 'w-full rounded-md border border-border bg-surfaceAlt px-2.5 py-1.5 text-sm text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40'

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-accent' : 'bg-textMute'}`} aria-hidden="true" />
          {on ? `타임라인 연동됨 · ${n}단계` : '타임라인 연동'}
        </span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="기획 타임라인 연동">
        <div className="space-y-4">
          <p className="text-sm text-textDim leading-6">
            강의 기획안 링크를 넣으면 챕터·시간표를 불러와 상황판에 <b>&ldquo;기획 vs 실제 진행&rdquo;</b> 비교를 켭니다. 이후 관찰 기록과 대조해 정시/지연을 보여줍니다.
          </p>
          <input
            type="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…(강의 기획안 링크)" className={inputCls}
          />
          {err ? <p className="text-sm text-danger">{err}</p> : null}
          {on ? <p className="text-xs text-textMute">현재: {n}단계 연동됨{planned?.url ? ` · ${new URL(planned.url).hostname}` : ''}</p> : null}
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="accent" onClick={apply} disabled={busy || !url}>{busy ? '불러오는 중…' : on ? '다시 불러오기' : '연동'}</Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
