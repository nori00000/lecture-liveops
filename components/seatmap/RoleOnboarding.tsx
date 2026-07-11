'use client'

import { Card } from '@/components/ui/primitives'
import type { SeatmapRole } from './board-hooks'

const CHOICES: { role: SeatmapRole; title: string; desc: string }[] = [
  { role: 'facilitator', title: '퍼실리테이터 (돌아다니며 마킹)', desc: '목록 뷰 + 문제 마킹 모드로 바로 시작합니다.' },
  { role: 'instructor', title: '메인강사 (한눈에 모니터링)', desc: '배치도 + 강사 뷰로 바로 시작합니다.' }
]

/** 첫 진입 1회 역할 선택 카드 — 첫 결정을 1개로 줄인다. 설정의 "역할 다시 선택"으로 재노출. */
export function RoleOnboarding({ onSelect }: { onSelect: (role: SeatmapRole) => void }) {
  return (
    <Card data-role-onboarding className="max-w-xl mx-auto mt-4 md:mt-12 p-5 md:p-8 flex flex-col gap-4">
      <div>
        <h2 className="text-lg md:text-xl font-semibold text-text">어떤 역할인가요?</h2>
        <p className="mt-1 text-sm text-textDim">
          한 번만 고르면 다음부터 바로 시작합니다. 설정에서 언제든 다시 선택할 수 있습니다.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {CHOICES.map((c) => (
          <button
            key={c.role}
            type="button"
            data-role-choice={c.role}
            onClick={() => onSelect(c.role)}
            className={
              'w-full min-h-[72px] px-4 py-3 rounded-md border border-border bg-surfaceAlt text-left ' +
              'transition-colors hover:bg-border hover:border-textMute focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
            }
          >
            <span className="block text-base font-semibold text-text">{c.title}</span>
            <span className="block mt-0.5 text-xs text-textDim">{c.desc}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
