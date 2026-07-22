import { NextResponse } from 'next/server'
import { sessions, delibRounds, delibGroups, participants, statements, landscape } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

// 워크숍 운영 개요 — 세션 + 라운드 + 그룹 현황(멤버 수) + 참가자/발언 카운트.
// operator 전용 데이터: /api/data 하위이므로 미들웨어 operator 게이트가 자동 보호한다.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const [rounds, groups, parts, stmts, snaps] = await Promise.all([
    delibRounds.list(ctx, sessionId),
    delibGroups.list(ctx, sessionId),
    participants.list(ctx, sessionId),
    statements.list(ctx, sessionId),
    landscape.list(ctx, sessionId)
  ])
  const memberships = await Promise.all(groups.map((g) => delibGroups.listMemberships(ctx, g.id)))
  const groupViews = groups.map((g, i) => ({
    id: g.id,
    label: g.label,
    topic: g.topic,
    memberCount: memberships[i].length
  }))
  const activeRound = rounds.find((r) => r.status === 'active') ?? null
  const publishedCount = snaps.filter((s) => s.published_at != null).length

  return NextResponse.json({
    ok: true,
    session: { id: session.id, title: session.title, date: session.date },
    rounds,
    activeRound,
    groups: groupViews,
    participantCount: parts.length,
    statementCount: stmts.length,
    publishedSnapshotCount: publishedCount
  })
}
