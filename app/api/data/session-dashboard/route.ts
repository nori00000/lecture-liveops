import { NextResponse } from 'next/server'
import { sessions, observations, materialVersions, opsLogs } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { nowIso } from '@/lib/util/id'
import { buildSessionDashboard } from '@/lib/liveops/dashboard'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  const session = sessionId
    ? await sessions.findById(adminContext(sessionId), sessionId)
    : await sessions.getToday(adminContext())
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  const obs = await observations.listBySession(session.id)
  const mats = await materialVersions.listBySession(session.id)
  const ops = await opsLogs.list(adminContext(session.id), session.id)
  const rawNotes = ops.map((o) => ({
    id: o.id,
    session_id: o.session_id,
    raw_text: o.body,
    author_role: o.created_by_role,
    source: 'web' as const,
    created_at: o.created_at
  }))
  return NextResponse.json(buildSessionDashboard({ session, rawNotes, observations: obs, materials: mats, now: nowIso() }))
}
