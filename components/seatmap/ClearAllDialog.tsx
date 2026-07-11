'use client'

import { useState } from 'react'

// 전체 초기화 — 실수 방지를 위해 경고 다이얼로그를 거친 뒤에만 실행한다.
// 확인 전 기본 포커스는 '취소' (ADHD: 반사적 더블탭으로 데이터가 날아가지 않게).
export function ClearAllDialog({ onClearAll }: { onClearAll: () => Promise<number> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function run() {
    setBusy(true)
    try {
      const cleared = await onClearAll()
      setMessage(`좌석 ${cleared}석 마킹이 초기화되었습니다.`)
      setOpen(false)
    } catch {
      setMessage('초기화 실패 — 연결 확인 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
      window.setTimeout(() => setMessage(''), 4000)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-border bg-surfaceAlt px-3 min-h-[44px] md:min-h-[36px] text-xs text-textDim hover:text-text hover:bg-border whitespace-nowrap"
      >
        전체 초기화
      </button>
      {message ? (
        <span role="status" aria-live="polite" className="text-xs text-textDim">
          {message}
        </span>
      ) : null}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60" onClick={() => (busy ? null : setOpen(false))}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-all-title"
            aria-describedby="clear-all-desc"
            className="w-full max-w-sm rounded-md border border-border bg-surface p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 id="clear-all-title" className="text-base font-semibold">
                전체 초기화 하시겠습니까?
              </h2>
              <p id="clear-all-desc" className="text-sm text-textDim mt-1">
                모든 좌석의 문제·해결 표시와 메모가 지워집니다. 되돌릴 수 없습니다.
              </p>
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
                {busy ? '초기화 중…' : '전체 초기화'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
