'use client'

import { useEffect, useState } from 'react'
import { useBodyScrollLock } from './board-hooks'
import { SeatDetailBody, seatDetailTitle } from './SeatDetailPanel'
import type { SeatMark, SeatStatus, SeatTable } from './types'

type Props = {
  seatKey: string
  table: SeatTable | null
  mark: SeatMark | null
  saving: boolean
  onSetStatus: (status: SeatStatus) => void
  onSetReason: (reason: string | null) => void
  onSaveMemo: (memo: string) => void
  onClose: () => void
}

/** 모바일 좌석 상세 바텀시트 — dim 배경 + 슬라이드 업 + body 스크롤 잠금.
 *  데스크톱(md+)에서는 렌더하지 않고 기존 우측 카드를 쓴다. */
export function SeatDetailSheet({ seatKey, table, mark, saving, onClose, ...handlers }: Props) {
  const entered = useEnterTransition()
  useBodyScrollLock(true)
  useEscapeKey(onClose)
  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <div
        className={
          'absolute inset-0 bg-black/60 transition-opacity duration-200 ' +
          (entered ? 'opacity-100' : 'opacity-0')
        }
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="좌석 상세"
        data-seat-detail-sheet=""
        className={
          'absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-lg ' +
          'border-t border-border bg-surface pb-[max(env(safe-area-inset-bottom),12px)] ' +
          'transition-transform duration-200 ' +
          (entered ? 'translate-y-0' : 'translate-y-full')
        }
      >
        <SheetHeader title={seatDetailTitle(table, seatKey)} hint={seatKey} onClose={onClose} />
        <SeatDetailBody
          idPrefix="sheet"
          seatKey={seatKey}
          table={table}
          mark={mark}
          saving={saving}
          {...handlers}
        />
      </div>
    </div>
  )
}

function SheetHeader({ title, hint, onClose }: { title: string; hint: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 bg-surface border-b border-border pl-4 pr-1.5 py-1 flex items-center gap-2">
      <span className="text-sm font-medium text-text">{title}</span>
      <span className="text-xs text-textMute">{hint}</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="상세 닫기"
        className="ml-auto min-w-[44px] min-h-[44px] flex items-center justify-center rounded text-textDim hover:text-text hover:bg-surfaceAlt transition-colors"
      >
        <CloseIcon />
      </button>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 14 14" aria-hidden="true" className="w-3.5 h-3.5">
      <path
        d="M 2 2 L 12 12 M 12 2 L 2 12"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  )
}

/** 마운트 직후 한 프레임 뒤 true — translate/opacity 전환으로 슬라이드 업. */
function useEnterTransition(): boolean {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setEntered(true))
    return () => window.cancelAnimationFrame(id)
  }, [])
  return entered
}

function useEscapeKey(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}
