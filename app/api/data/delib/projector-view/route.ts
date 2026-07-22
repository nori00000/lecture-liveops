import { NextResponse } from 'next/server'
import { sessions, landscape, statements } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import type { SnapshotPayload } from '@/lib/delib/metrics'

// 프로젝터 결과판 데이터 — 발표용 스냅샷 스냅샷(consensus/divisive/소수의견).
// 이미 publish 된 스냅샷의 집계 payload 만 노출한다(개인 표 없음, k-익명 억제는 metrics 에서 적용됨).
// operator 전용: /api/data 하위이므로 미들웨어 operator 게이트가 자동 보호.
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const snaps = await landscape.list(ctx, sessionId)
  // landscape.list 는 computed_at desc 정렬 → published 중 최신 1건.
  const latestPublished = snaps.find((s) => s.published_at != null) ?? null

  if (!latestPublished) {
    return NextResponse.json({
      ok: true,
      published: false,
      session: { id: session.id, title: session.title, date: session.date }
    })
  }

  // 결과판은 발언 원문을 함께 보여줘야 의미가 있다 — 스냅샷 payload 는 statementId·집계만 담으므로
  // 현재 visible 발언의 id→body 맵을 덧붙인다 (집계+텍스트, 개인 표는 여전히 미노출).
  const visible = await statements.list(ctx, sessionId, latestPublished.round_id ?? undefined, { visibleOnly: true })
  const statementBodies: Record<string, string> = {}
  for (const s of visible) statementBodies[s.id] = s.body

  return NextResponse.json({
    ok: true,
    published: true,
    session: { id: session.id, title: session.title, date: session.date },
    snapshotId: latestPublished.id,
    computedAt: latestPublished.computed_at,
    publishedAt: latestPublished.published_at,
    payload: latestPublished.payload as unknown as SnapshotPayload,
    statementBodies
  })
}
