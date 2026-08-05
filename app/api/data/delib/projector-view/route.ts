import { NextResponse } from 'next/server'
import { sessions, landscape, statements } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import type { SnapshotPayloadWithLandscape } from '@/lib/delib/landscapeMetrics'
import { rerankSnapshot } from '@/lib/delib/metrics'

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
  // 랭킹은 read 시점에 항상 다시 나눈다 — 레거시(방향맹 consensus) 교정 목적이며, 신규 포맷도
  // 같은 규칙·같은 수치라 결과가 동일하다. 저장된 발행 스냅샷 자체는 절차 증빙이므로 변조하지 않는다.
  // 여기서는 리포트와 달리 상위 N 컷오프(기본 5)를 유지한다 — 방 전체 화면의 가독성 제약.
  const stored = rerankSnapshot(
    latestPublished.payload as unknown as SnapshotPayloadWithLandscape
  )
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
    ...(payload.opposed ?? []).map((m) => m.statementId),
    ...(payload.divisive ?? []).map((m) => m.statementId),
    ...(payload.minority ?? []).map((m) => m.statementId),
    ...landscapeIds
  ])
  // 원문 노출 범위 — 이 화면은 방 전체가 본다.
  // dialogue projector 와 달리 여기서는 visibility='group' 발언을 제외하지 않는다:
  //   이 payload 는 운영자가 delib.publish_snapshot 으로 **명시 발행한** 스냅샷에서만 나오고,
  //   발행 전에는 published:false 로 아무것도 내려가지 않는다. 그 발행이 곧 진행자 승인 게이트다
  //   (DIALOGUE-LENS Must-Never #2 가 요구하는 승인). 실시간·무승인인 dialogue projector 와 다르다.
  //   현재 참가자 UI 는 visibility 를 고르게 하지 않고 'group' 으로 고정 제출하므로,
  //   group 을 제외하면 결과판이 항상 비어 MVP 자체가 동작하지 않는다.
  // 다만 'private' 은 어떤 경우에도 방 전체 화면에 올리지 않는다 — 승인과 무관한 비공개 표기다.
  const visible = await statements.list(ctx, sessionId, latestPublished.round_id ?? undefined, { visibleOnly: true })
  const statementBodies: Record<string, string> = {}
  for (const s of visible) {
    if (s.visibility === 'private') continue
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
