'use client'

import Link from 'next/link'
import { Card, CardHeader, Button } from '@/components/ui/primitives'
import { useSessionData } from '@/lib/realtime/channel'
import type { SeatmapResponse, SeatTable } from '@/components/seatmap/types'

// 상황판 팀 현황 스트립 — 이 세션 배치도의 팀을 요약해 보여준다.
// 팀/좌석 데이터는 좌석 보드와 같은 /api/data/seatmap 을 쓴다(상황판 대시보드 API엔 팀이 없음).
export function TeamStatusStrip({ sessionId }: { sessionId: string }) {
  const { data } = useSessionData<SeatmapResponse>(
    `/api/data/seatmap?sessionId=${encodeURIComponent(sessionId)}`,
    5000
  )

  if (!data) return null // 로딩 중엔 조용히 (레이아웃 흔들림 방지)

  const layout = data.layout
  const tables = layout?.layout.tables ?? []
  const marks = data.marks ?? []

  if (tables.length === 0) {
    return (
      <Card>
        <CardHeader title="팀 현황" />
        <div className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-textDim">
            아직 배치도가 없어 표시할 팀이 없습니다. 팀을 만들면 여기와 좌석 보드에 나타납니다.
          </p>
          <Link href="/today/seatmap/builder">
            <Button variant="accent">배치도 편집</Button>
          </Link>
        </div>
      </Card>
    )
  }

  const problemCount = (t: SeatTable) =>
    marks.filter((m) => m.status === 'problem' && t.seats.some((s) => s.key === m.seat_key)).length

  return (
    <Card>
      <CardHeader title="팀 현황" hint={`${tables.length}팀`} />
      <div className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {tables.map((t) => {
            const size = t.roster?.length ?? t.seats.length
            const problems = problemCount(t)
            return (
              <Link
                key={t.label}
                href="/today/seatmap"
                className="rounded border border-border bg-surfaceAlt px-3 py-2 hover:bg-border transition-colors"
              >
                <div className="text-sm font-medium text-text">{t.label}</div>
                <div className="text-xs text-textMute mt-0.5 flex items-center gap-2">
                  <span>{size}명</span>
                  {problems > 0 ? (
                    <span className="text-danger">문제 {problems}</span>
                  ) : (
                    <span className="text-textDim">이상 없음</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
        <div className="mt-3">
          <Link href="/today/seatmap">
            <Button size="sm">좌석 보드 열기</Button>
          </Link>
        </div>
      </div>
    </Card>
  )
}
