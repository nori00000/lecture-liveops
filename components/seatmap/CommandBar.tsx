'use client'

// Lecture LiveOps — 좌석 보드 자연어 명령 입력줄 (퍼실리테이터 도구, 강사 뷰에서는 숨김)
// "14 15 문제" → 빨간불, "14 해결 SSL이었음" → 초록불 + 좌석일지. 모바일 우선 1줄 UI.

import { useState } from 'react'
import { apiFetch } from '@/lib/api/fetcher'

type AssistResponse = { ok?: boolean; message?: string; error?: string }
type Notice = { kind: 'ok' | 'error'; text: string }

export function CommandBar({ sessionId, onApplied }: { sessionId: string; onApplied: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  async function submit() {
    const cmd = text.trim()
    if (!cmd || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetch('/api/assist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, text: cmd })
      })
      const data = (await res.json().catch(() => ({}))) as AssistResponse
      if (res.ok && data.ok) {
        setNotice({ kind: 'ok', text: data.message ?? '적용되었습니다' })
        setLastRun(cmd)
        setText('')
        onApplied()
      } else {
        // 실패 시 입력 유지 — 수정 후 바로 재시도할 수 있게 한다
        setNotice({ kind: 'error', text: data.message ?? data.error ?? '실행 실패 — 다시 시도해 주세요' })
      }
    } catch {
      setNotice({ kind: 'error', text: '전송 실패 — 연결 확인 후 다시 시도해 주세요' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-command-bar className="flex flex-col gap-1.5">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 14 15 문제 · 3조 2번 해결 설치였음"
          aria-label="좌석 명령 입력"
          enterKeyHint="send"
          className="flex-1 min-w-0 min-h-[44px] bg-bg border border-border rounded-md px-3 text-sm text-text placeholder-textMute focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="shrink-0 min-h-[44px] min-w-[64px] px-3 rounded-md border border-accentDim/60 bg-accentDim/20 text-sm font-medium text-accent transition-colors hover:bg-accentDim/35 disabled:opacity-50"
        >
          {busy ? '전송중' : '전송'}
        </button>
      </form>
      <CommandBarStatus notice={notice} lastRun={lastRun} />
    </div>
  )
}

/** 응답 메시지(role=status) + 최근 실행 1건 — 둘 다 없으면 렌더하지 않는다. */
function CommandBarStatus({ notice, lastRun }: { notice: Notice | null; lastRun: string | null }) {
  if (!notice && !lastRun) return null
  return (
    <div className="flex flex-col gap-0.5 px-0.5">
      {notice ? (
        <p
          role="status"
          data-command-result
          className={'text-xs ' + (notice.kind === 'ok' ? 'text-accent' : 'text-[#ef8080]')}
        >
          {notice.text}
        </p>
      ) : null}
      {lastRun ? <p className="text-xs text-textMute truncate">최근 실행: {lastRun}</p> : null}
    </div>
  )
}
