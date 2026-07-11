import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/primitives'
import { ObservationTimeline } from '@/components/liveops/ObservationTimeline'
import { sessions, observations, opsLogs } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import type { OpsLog } from '@/lib/db/schema'
import type { StructuredObservation } from '@/lib/liveops/types'

type PageProps = { params: Promise<{ id: string }> }

export default async function SessionTimelinePage({ params }: PageProps) {
  const { id } = await params
  const ctx = adminContext(id)
  const session = await sessions.findById(ctx, id)
  if (!session) notFound()
  const [obs, ops] = await Promise.all([observations.listBySession(id), opsLogs.list(ctx, id)])
  const timeline = obs.length > 0 ? obs : ops.map(opsToObservation)
  return (
    <div className="p-6 space-y-4">
      <PageHeader title="세션 타임라인" desc={`${session.title} · 저장된 관찰/운영 로그를 시간순으로 복원`} />
      <ObservationTimeline observations={timeline} />
    </div>
  )
}

function opsToObservation(row: OpsLog): StructuredObservation {
  return {
    id: row.id,
    session_id: row.session_id,
    category: opsTypeToCategory(row.type),
    severity: row.type === 'issue' ? 'high' : 'low',
    visibility: row.visibility,
    summary: row.body,
    confidence: 1,
    created_at: row.created_at
  }
}

function opsTypeToCategory(type: OpsLog['type']): StructuredObservation['category'] {
  if (type === 'issue') return 'error'
  if (type === 'question') return 'question'
  if (type === 'signal') return 'signal'
  if (type === 'mood') return 'mood'
  if (type === 'resource') return 'material'
  if (type === 'progress') return 'progress'
  return 'action'
}
