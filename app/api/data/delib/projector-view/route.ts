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

  // M3: 결과판은 랭킹(consensus/divisive/minority)에 실제 표시되는 발언 원문만 내려보낸다.
  // suppressed(k-익명 억제)·랭킹 미표시 발언의 원문은 payload 로 새어나가지 않게 allowlist 로 제외한다.
  const payload = latestPublished.payload as unknown as SnapshotPayload
  const shownIds = new Set<string>([
    ...(payload.consensus ?? []).map((m) => m.statementId),
    ...(payload.divisive ?? []).map((m) => m.statementId),
    ...(payload.minority ?? []).map((m) => m.statementId)
  ])
  const visible = await statements.list(ctx, sessionId, latestPublished.round_id ?? undefined, { visibleOnly: true })
  const statementBodies: Record<string, string> = {}
  for (const s of visible) {
    if (shownIds.has(s.id)) statementBodies[s.id] = s.body
  }

  return NextResponse.json({
    ok: true,
    published: true,
    session: { id: session.id, title: session.title, date: session.date },
    snapshotId: latestPublished.id,
    computedAt: latestPublished.computed_at,
    publishedAt: latestPublished.published_at,
    payload,
    statementBodies
  })
}
