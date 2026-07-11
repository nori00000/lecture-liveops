'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/primitives'

// 세션 아카이브 카드에서 해당 세션을 LLM 기반 단일 HTML 문서로 생성해 즉시 다운로드한다.
// 실패 시 서버(route)가 결정론 fallback HTML을 반환하므로 빈손 다운로드는 없다. 생성은 최대 ~1분.
export function SessionHtmlButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function downloadHtml() {
    if (busy) return
    setBusy(true)
    setMsg('생성 중…')
    try {
      const res = await fetch(`/api/export/html?sessionId=${encodeURIComponent(sessionId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const engine = res.headers.get('x-export-engine') ?? '?'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''(.+)$/)
      a.download = m ? decodeURIComponent(m[1]) : 'session.html'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setMsg(engine !== 'fallback' ? `완료 (${engine})` : '완료')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" onClick={downloadHtml} disabled={busy}>
        {busy ? 'HTML 생성 중…' : 'HTML 생성하기'}
      </Button>
      {msg ? <span className="text-[11px] text-textDim">{msg}</span> : null}
    </span>
  )
}
