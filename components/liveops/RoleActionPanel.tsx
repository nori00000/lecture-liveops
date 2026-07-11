'use client'

import { Card, CardHeader } from '@/components/ui/primitives'
import type { SituationSnapshot, StructuredObservation } from '@/lib/liveops/types'

// 메인 강사가 바로 볼 것(우선순위 urgent) / 보조강사 우선순위(high) — 미해결 관찰 항목을 모아 보여주고,
// 각 항목 옆 '해결' 버튼으로 처리한다. 해결완료(resolved) 전까지 이 목록에 남는다(해결 시 목록에서 빠지고
// 관찰로그에 연한 초록 '해결완료' 배지로 남는다). solution 카테고리 content 도 목록에서는 제외한다.
export function RoleActionPanel({
  snapshot,
  observations = [],
  onResolve
}: {
  snapshot: SituationSnapshot
  observations?: StructuredObservation[]
  onResolve?: (id: string) => void
}) {
  const open = observations.filter((o) => o.category !== 'solution' && !o.resolved)
  // 대상 태그(audience) 기준 — 'both'면 양쪽 패널에 모두 표시. 미지정 시 severity로 보조 분류.
  const main = open.filter((o) => o.audience === 'main' || o.audience === 'both' || (!o.audience && o.severity === 'urgent'))
  const assist = open.filter((o) => o.audience === 'assistant' || o.audience === 'both' || (!o.audience && o.severity === 'high'))
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <FollowupCard
        title="메인 강사가 바로 볼 것"
        items={main}
        suggested={snapshot.suggested_main_instructor_actions}
        onResolve={onResolve}
      />
      <FollowupCard
        title="보조강사 우선순위"
        items={assist}
        suggested={snapshot.suggested_assistant_actions}
        onResolve={onResolve}
      />
    </div>
  )
}

function FollowupCard({
  title,
  items,
  suggested,
  onResolve
}: {
  title: string
  items: StructuredObservation[]
  suggested: string[]
  onResolve?: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader title={title} hint={items.length > 0 ? `미해결 ${items.length}건` : 'AI 정리'} />
      <ul className="p-4 space-y-2">
        {items.map((o) => (
          <li key={o.id} className="flex gap-2 items-start text-sm">
            <span className="flex-1 leading-6 text-text whitespace-pre-wrap break-words">
              {o.target ? <span className="text-textMute">[{o.target}] </span> : null}
              {o.summary}
            </span>
            {onResolve ? (
              <button
                type="button"
                onClick={() => onResolve(o.id)}
                aria-label="해결 처리"
                title="해결 처리"
                className="shrink-0 h-6 px-2 rounded-full border border-border text-textMute hover:border-accent hover:text-accent transition-colors text-[11px]"
              >
                해결
              </button>
            ) : null}
          </li>
        ))}
        {items.length === 0
          ? suggested.length > 0
            ? suggested.map((s, i) => (
                <li key={`${s}-${i}`} className="flex gap-3 text-sm text-textDim leading-6">
                  <span className="w-6 h-6 rounded-full bg-accentDim/20 text-accent border border-accentDim/40 inline-flex items-center justify-center text-xs shrink-0">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))
            : <li className="text-sm text-textMute">대기 중인 항목 없음</li>
          : null}
      </ul>
    </Card>
  )
}
