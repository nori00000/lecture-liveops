'use client'

import type { EvidenceKind } from '@/lib/db/schema'

// Q1 근거 유형 자기 태깅 컨트롤 (DELIBERATION-QUALITY-PLAN §2 Q1).
// 참가자 **본인**이 자기 발언의 근거 유형을 고른다 — AI 판정이 아니므로 오탐이 없다.
//
// 접근성(VoteControls 와 동일 기준):
//  - 색이 유일 정보수단이 되지 않도록 색 + 글리프(형태) + 텍스트 라벨 3중 표기
//  - 최소 터치 타겟 44px, aria-pressed 로 선택 상태 전달
//  - 선택은 **선택사항**이고 기본값이 없다. 선택된 항목을 다시 누르면 해제된다.
type Option = { value: EvidenceKind; label: string; hint: string; glyph: string; onClasses: string }

const OPTIONS: Option[] = [
  { value: 'experience', label: '경험', hint: '직접 겪음', glyph: '◆', onClasses: 'bg-accentDim border-accent text-text' },
  { value: 'source', label: '자료·출처', hint: '근거 있음', glyph: '▣', onClasses: 'bg-info/25 border-info text-text' },
  { value: 'estimate', label: '추정', hint: '제 생각', glyph: '◇', onClasses: 'bg-surfaceAlt border-textDim text-text' }
]

export function EvidenceKindControls({
  value,
  onChange,
  disabled = false,
  idBase
}: {
  value?: EvidenceKind | null
  onChange: (v: EvidenceKind | null) => void
  disabled?: boolean
  idBase: string
}) {
  return (
    <div role="group" aria-label="이 주장의 근거 유형 (선택사항)" className="grid grid-cols-3 gap-2">
      {OPTIONS.map((o) => {
        const selected = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            id={`${idBase}-${o.value}`}
            aria-pressed={selected}
            aria-label={`근거 유형 ${o.label}, ${o.hint}${selected ? ', 선택됨. 다시 누르면 해제' : ''}`}
            disabled={disabled}
            // 다시 누르면 해제 — 기본값 없음을 되돌릴 수 있어야 한다.
            onClick={() => onChange(selected ? null : o.value)}
            className={
              'min-h-[44px] rounded-md border-2 px-2 py-2 text-sm font-medium transition-colors ' +
              'flex flex-col items-center justify-center gap-0.5 ' +
              'disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-accent ' +
              (selected ? o.onClasses : 'bg-bg border-border text-textDim hover:border-textDim hover:text-text')
            }
          >
            <span aria-hidden="true" className="text-base leading-none">{o.glyph}</span>
            <span>{o.label}</span>
            <span className="text-[10px] font-normal">{selected ? '선택됨' : o.hint}</span>
          </button>
        )
      })}
    </div>
  )
}
