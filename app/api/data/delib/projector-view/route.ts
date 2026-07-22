import { NextResponse } from 'next/server'
import { sessions, landscape, statements } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import type { SnapshotPayloadWithLandscape } from '@/lib/delib/landscapeMetrics'

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
  const stored = latestPublished.payload as unknown as SnapshotPayloadWithLandscape
  // H2(2026-07-22): landscape.projection(개별 좌표)은 익명이 아니다 — 좌표는 개인 투표 벡터의
  // 저차원 서명이라 공개 발언·현장 관찰과 결합하면 재식별 가능하다.
  // 좌표는 스냅샷 내부에만 남기고 공개 payload 에서는 제거한다 (클러스터 규모·대표문장·설명분산만 노출).
  const payload: SnapshotPayloadWithLandscape = stored.landscape
    ? { ...stored, landscape: { ...stored.landscape, projection: [] } }
    : stored
  // 의견 지형(landscape)의 GIC/대표의견도 화면에 원문이 필요하므로 allowlist 에 포함한다.
  const landscapeIds = payload.landscape?.enabled
    ? [
        ...(payload.landscape.gic ?? []).map((g) => g.statementId),
        ...(payload.landscape.representatives ?? []).map((r) => r.statementId)
      ]
    : []
  const shownIds = new Set<string>([
    ...(payload.consensus ?? []).map((m) => m.statementId),
    ...(payload.divisive ?? []).map((m) => m.statementId),
    ...(payload.minority ?? []).map((m) => m.statementId),
    ...landscapeIds
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
