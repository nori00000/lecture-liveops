import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui/primitives'
import { SituationHero } from '@/components/liveops/SituationHero'
import { RoleActionPanel } from '@/components/liveops/RoleActionPanel'
import { QuickNoteComposer } from '@/components/liveops/QuickNoteComposer'
import { MaterialStatusPanel } from '@/components/liveops/MaterialStatusPanel'
import { ObservationTimeline } from '@/components/liveops/ObservationTimeline'
import { sessions, observations, materialVersions, opsLogs } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { nowIso } from '@/lib/util/id'
import { buildSessionDashboard, sessionMeta } from '@/lib/liveops/dashboard'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ id: string }> }

export default async function SessionDashboardPage({ params }: PageProps) {
  const { id } = await params
  const session = await sessions.findById(adminContext(id), id)
  if (!session) notFound()
  const obs = await observations.listBySession(id)
  const mats = await materialVersions.listBySession(id)
  const ops = await opsLogs.list(adminContext(id), id)
  const rawNotes = ops.map((o) => ({ id: o.id, session_id: o.session_id, raw_text: o.body, author_role: o.created_by_role, source: 'web' as const, created_at: o.created_at }))
  const dashboard = buildSessionDashboard({ session, observations: obs, materials: mats, rawNotes, now: nowIso() })
  const meta = sessionMeta(session)

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={session.title}
        desc={`${meta.companyName ?? session.company_id} · ${session.date} · ${session.venue || '장소 미지정'} · ${meta.category ?? '교육 카테고리 미지정'}`}
      />
      <SituationHero snapshot={dashboard.snapshot} />
      <RoleActionPanel snapshot={dashboard.snapshot} />
      <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <QuickNoteComposer sessionId={session.id} />
        <MaterialStatusPanel materials={dashboard.materials} />
      </div>
      <ObservationTimeline observations={dashboard.observations} />
    </div>
  )
}
