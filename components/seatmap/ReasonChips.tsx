'use client'

import { REASON_OPTIONS } from './seat-utils'

type Props = {
  /** 현재 선택된 사유 key — 없으면 null. */
  current: string | null
  disabled?: boolean
  /** 모바일에서 줄바꿈 대신 가로 스크롤 1줄로 표시(툴바용). */
  scrollOnMobile?: boolean
  /** 같은 칩을 다시 누르면 null로 해제된다. */
  onSelect: (reason: string | null) => void
}

export function ReasonChips({ current, disabled = false, scrollOnMobile = false, onSelect }: Props) {
  const flow = scrollOnMobile ? 'flex-nowrap overflow-x-auto md:flex-wrap md:overflow-visible' : 'flex-wrap'
  return (
    <div className={'flex gap-1.5 ' + flow} role="group" aria-label="문제 사유 선택">
      {REASON_OPTIONS.map((o) => {
        const active = current === o.value
        return (
          <button
            key={o.value}
            type="button"
            data-reason-chip={o.value}
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onSelect(active ? null : o.value)}
            className={
              'shrink-0 px-2.5 py-1 min-w-[44px] min-h-[44px] md:min-h-[32px] text-xs rounded border transition-colors ' +
              'disabled:opacity-40 disabled:cursor-not-allowed ' +
              (active
                ? 'bg-warn/20 border-warn/60 text-warn'
                : 'bg-surfaceAlt border-border text-textDim hover:text-text hover:bg-border')
            }
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
