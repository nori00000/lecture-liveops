import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { sessions, qna, practice, resources, opsLogs } from '@/lib/db/repo'
import { adminContext, type RlsContext } from '@/lib/db/neonHelpers'
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const cookieStore = await cookies()
  const participantSession = readParticipantSession(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value)
  if (!participantSession) return NextResponse.json({ ok: false, error: 'participant session required' }, { status: 401 })

  const ctx: RlsContext = { role: participantSession.role, sessionId: participantSession.sessionId }
  const session = (await sessions.findById(ctx, participantSession.sessionId))
    ?? (await sessions.findById(adminContext(participantSession.sessionId), participantSession.sessionId))
  if (!session) return NextResponse.json({ ok: false, error: 'session missing' }, { status: 404 })

  const [qnaRows, ptRows, rsRows, opRows] = await Promise.all([
    qna.list(ctx, session.id),
    practice.list(ctx, session.id),
    resources.list(ctx, session.id),
    opsLogs.list(ctx, session.id)
  ])

  return NextResponse.json(
    {
      ok: true,
      role: participantSession.role,
      session,
      qna: qnaRows.map((q) => ({ id: q.id, body: q.body_redacted || q.body, status: q.status })),
      practice: ptRows.filter((p) => p.status !== 'follow_up'),
      resources: rsRows.filter((r) => r.visibility === 'public' || r.visibility === 'session'),
      // fail-closed allowlist: 참가자에게 보여도 되는 visibility만 통과.
      // OpsLog 기본값 'private'는 운영진 전용 — denylist('admin_only'만 제외) 방식이면 노출된다.
      // type 'note'(빠른 입력 raw 관찰 원문)는 운영 기록이므로 공지에서 제외 —
      // 운영진이 명시 발행한 mood/progress만 참가자 공지로 통과한다.
      announcements: opRows
        .filter((o) => ['mood', 'progress'].includes(o.type) && ['public', 'session'].includes(o.visibility))
        .slice(0, 10)
    },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
