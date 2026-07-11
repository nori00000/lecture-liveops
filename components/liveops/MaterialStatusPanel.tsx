import { Badge, Card, CardHeader } from '@/components/ui/primitives'
import type { MaterialVersion } from '@/lib/liveops/types'

export function MaterialStatusPanel({ materials }: { materials: MaterialVersion[] }) {
  return (
    <Card>
      <CardHeader title="자료 상태" hint={`${materials.length}개`} />
      <div className="p-4 space-y-3">
        {materials.slice(0, 6).map((m) => (
          <div key={m.id} className="flex items-start justify-between gap-3 border-b border-border last:border-b-0 pb-3 last:pb-0">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={toneForStatus(m.status)}>{m.status}</Badge>
                <span className="text-sm font-medium text-text">{m.title}</span>
              </div>
              <p className="text-xs text-textMute mt-1">v{m.version} · {m.audience} · {m.latest_change_summary ?? '변경 요약 없음'}</p>
            </div>
            <span className="text-[11px] text-textMute shrink-0">{m.type}</span>
          </div>
        ))}
        {!materials.length ? <div className="text-sm text-textMute">아직 등록된 자료가 없습니다.</div> : null}
      </div>
    </Card>
  )
}

function toneForStatus(status: MaterialVersion['status']) {
  if (status === 'shared') return 'accent' as const
  if (status === 'review') return 'warn' as const
  if (status === 'archived') return 'neutral' as const
  return 'info' as const
}
