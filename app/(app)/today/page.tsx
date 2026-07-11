import Link from 'next/link'
import { Button, PageHeader } from '@/components/ui/primitives'
import { DashboardLive } from '@/components/liveops/DashboardLive'
import { EndSessionButton } from '@/components/liveops/EndSessionButton'
import { SessionPicker } from '@/components/liveops/SessionPicker'
import { TimelineSyncButton } from '@/components/liveops/TimelineSyncButton'
import { observations, materialVersions, opsLogs } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { nowIso } from '@/lib/util/id'
import { buildSessionDashboard, sessionMeta } from '@/lib/liveops/dashboard'
import { resolveBoardSession } from '@/lib/liveops/board-session'

export const dynamic = 'force-dynamic'

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ sessionId?: string }> }) {
  // 분반(A/B/C)은 ?sessionId=(공유 링크) → 쿠키(직전 선택) → getToday 순으로 해석한다.
  const sp = await searchParams
  const session = await resolveBoardSession(sp?.sessionId)
  if (!session) {
    return (
      <div className="p-6 space-y-4">
        <PageHeader
          title="상황판"
          desc="진행 중인 세션이 없습니다. 위에서 분반을 고르거나 새 세션을 만들어 시작하세요."
          right={<SessionPicker current={sp?.sessionId ?? null} />}
        />
        <div className="flex flex-wrap gap-2">
          <Link href="/sessions/new"><Button variant="accent">새 세션 만들기</Button></Link>
          <Link href="/sessions"><Button>지난 세션 보기</Button></Link>
        </div>
      </div>
    )
  }
  const obs = await observations.listBySession(session.id)
  const mats = await materialVersions.listBySession(session.id)
  const ops = await opsLogs.list(adminContext(session.id), session.id)
  const rawNotes = ops.map((o) => ({ id: o.id, session_id: o.session_id, raw_text: o.body, author_role: o.created_by_role, source: 'web' as const, created_at: o.created_at }))
  const dashboard = buildSessionDashboard({ session, observations: obs, materials: mats, rawNotes, now: nowIso() })
  const meta = sessionMeta(session)

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title="실시간 강의 상황판"
        desc={[
          session.title,
          session.date,
          // 강좌명(category)이 세션 제목과 같으면 중복 표기하지 않는다
          meta.category && meta.category !== session.title ? meta.category : null,
          meta.currentPhase
        ].filter(Boolean).join(' · ')}
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <SessionPicker current={session.id} />
            <TimelineSyncButton sessionId={session.id} initial={(session.metadata as { plannedTimeline?: { url?: string; chapters?: { id: string; title: string; start: string; end: string }[] } })?.plannedTimeline} />
            {session.mode !== 'archived' ? <EndSessionButton sessionId={session.id} sessionTitle={session.title} /> : null}
            <Link href={`/sessions/${session.id}`}><Button variant="accent">세션 상세</Button></Link>
          </div>
        }
      />
      <DashboardLive sessionId={session.id} initial={dashboard} planned={(session.metadata as { plannedTimeline?: { url?: string; chapters: { id: string; title: string; start: string; end: string }[] } })?.plannedTimeline} />
    </div>
  )
}
