'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/primitives'
import { invoke } from '@/lib/util/envelope'

// 교육 종료 — 실수 방지 경고 다이얼로그를 거친 뒤에만 실행한다.
// 기본 포커스는 '취소' (ADHD: 반사적 더블탭으로 세션이 내려가지 않게).
// 종료 = archived (삭제 아님). 데이터는 그대로 남고 아카이브에서 계속 조회된다.
export function EndSessionButton({ sessionId, sessionTitle }: { sessionId: string; sessionTitle: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    try {
      const res = await invoke({ action: 'liveops.end_session', role: 'instructor', scope: { sessionId }, input: { sessionId } })
      if (!res?.ok) {
        setError(res?.error === 'permission denied' ? '권한이 없습니다.' : '종료 실패 — 다시 시도해 주세요.')
        setBusy(false)
        return
      }
      setOpen(false)
      router.refresh()
    } catch {
      setError('종료 실패 — 연결 확인 후 다시 시도해 주세요.')
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>교육 종료</Button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60"
          onClick={() => (busy ? null : setOpen(false))}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="end-session-title"
            aria-describedby="end-session-desc"
            className="w-full max-w-md rounded-md border border-border bg-surface p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 id="end-session-title" className="text-base font-semibold">
                교육을 종료하시겠습니까?
              </h2>
              <p id="end-session-desc" className="text-sm text-textDim mt-1">
                <span className="text-text font-medium">{sessionTitle}</span> 세션을 종료하고 아카이브로 보관합니다.
                상황판에서 내려가고 다음 세션으로 전환됩니다. 좌석·관찰로그·QnA·자료 등 데이터는 삭제되지 않고
                아카이브에서 계속 조회할 수 있습니다.
              </p>
              {error ? (
                <p role="alert" className="text-sm text-[#ef8080] mt-2">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => setOpen(false)}
                className="rounded border border-border bg-surfaceAlt px-4 min-h-[44px] text-sm text-text hover:bg-border disabled:opacity-40"
              >
                취소
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run()}
                className="rounded border border-[#d64545] bg-[#d64545]/15 px-4 min-h-[44px] text-sm font-medium text-[#ef8080] hover:bg-[#d64545]/30 disabled:opacity-40"
              >
                {busy ? '종료 중…' : '교육 종료'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
