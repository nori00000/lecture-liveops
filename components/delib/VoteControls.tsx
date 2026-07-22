'use client'

import type { VoteValue } from '@/lib/db/schema'

// 찬성/반대/유보 3지선다 투표 컨트롤 — 접근성 수용기준(§3 2단계) 반영:
//  - 색이 유일 정보수단이 되지 않도록 색 + 아이콘(형태) + 텍스트 라벨 3중 표기 (색약 안전)
//  - 큰 터치 타겟(min 44px), aria-pressed 로 선택 상태 전달
//  - 선택 시 채움 + 링 + "선택됨" 보조 텍스트로 색 대비 없이도 상태 인지 가능
type Option = { value: VoteValue; label: string; glyph: string; onClasses: string }

const OPTIONS: Option[] = [
  { value: 'agree', label: '찬성', glyph: '✓', onClasses: 'bg-accentDim border-accent text-text' },
  { value: 'disagree', label: '반대', glyph: '✕', onClasses: 'bg-danger/25 border-danger text-text' },
  { value: 'pass', label: '유보', glyph: '—', onClasses: 'bg-surfaceAlt border-textDim text-text' }
]

export function VoteControls({
  value,
  onVote,
  disabled = false,
  idBase
}: {
  value?: VoteValue
  onVote: (v: VoteValue) => void
  disabled?: boolean
  idBase: string
}) {
  return (
    <div role="group" aria-label="투표 선택" className="grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => {
        const selected = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            id={`${idBase}-${o.value}`}
            aria-pressed={selected}
            aria-label={`${o.label}${selected ? ', 선택됨' : ''}`}
            disabled={disabled}
            onClick={() => onVote(o.value)}
            className={
              'min-h-[44px] rounded-md border-2 px-2 py-2 text-sm font-medium transition-colors ' +
              'flex flex-col items-center justify-center gap-0.5 ' +
              'disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent ' +
              (selected ? o.onClasses : 'bg-bg border-border text-textDim hover:border-textDim hover:text-text')
            }
          >
            <span aria-hidden="true" className="text-base leading-none">{o.glyph}</span>
            <span>{o.label}</span>
            {selected ? <span className="text-[10px] font-normal">선택됨</span> : null}
          </button>
        )
      })}
    </div>
  )
}
