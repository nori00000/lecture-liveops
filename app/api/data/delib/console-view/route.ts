import { NextResponse } from 'next/server'
import { sessions, delibRounds, delibGroups, participants, statements, votes, landscape, aiObservations } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { toConsoleCard } from '@/lib/delib/views'
import { computeEvidenceKindByRound } from '@/lib/delib/metrics'
import { readRecordingConsent } from '@/lib/action/handlers/delib'

// 퍼실리테이터 콘솔 데이터 — 그룹별 현황, moderation 큐, 투표 진행률.
// operator 전용: /api/data 하위이므로 미들웨어 operator 게이트가 자동 보호.
// 개인 표 원자료는 노출하지 않는다 — statement 별 tally(집계)만 (거버넌스 §7-2).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  // M4: 익명 모드 서버 반영 — 세션 metadata 의 privacy_settings.anonymousMode 가 true 면
  // 콘솔 멤버 alias 를 display_alias(실명 가능) 대신 anon_handle 로 마스킹한다.
  // participantId 는 대리입력(§7-7)에 필요하므로 유지한다.
  const privacySettings = (session.metadata?.privacy_settings ?? undefined) as { anonymousMode?: boolean } | undefined
  const anonymousMode = privacySettings?.anonymousMode === true

  const [rounds, groups, parts, allStatements] = await Promise.all([
    delibRounds.list(ctx, sessionId),
    delibGroups.list(ctx, sessionId),
    participants.list(ctx, sessionId),
    statements.list(ctx, sessionId)
  ])

  // 그룹별 멤버(참가자 alias) 매핑 — 좌석보드/그룹보드 재구성에 사용.
  const memberships = await Promise.all(groups.map((g) => delibGroups.listMemberships(ctx, g.id)))
  const partById = new Map(parts.map((p) => [p.id, p]))
  const groupViews = groups.map((g, i) => ({
    id: g.id,
    label: g.label,
    topic: g.topic,
    members: memberships[i].map((m) => {
      const p = partById.get(m.participant_id)
      // 익명 모드: display_alias 를 노출하지 않고 anon_handle 만 사용.
      const alias = anonymousMode
        ? (p?.anon_handle || m.participant_id.slice(0, 6))
        : (p?.display_alias || p?.anon_handle || m.participant_id.slice(0, 6))
      return { participantId: m.participant_id, alias }
    })
  }))

  // 집계는 tally 함수(개인 표 미노출)로만. 전체 발언에 대해 한 번에.
  const tallies = await votes.tallyByStatements(ctx, allStatements.map((s) => s.id))
  const cards = allStatements.map((s) => toConsoleCard(s, tallies[s.id]))

  // moderation 큐 — visible 이 아닌(flagged/hidden) 발언. 전이표는 repo 가 강제하므로 여기선 목록만.
  const moderationQueue = cards.filter((c) => c.moderationState !== 'visible')

  // 투표 진행률 — 집계된 총 표수 / (참가자수 × 집계대상 발언수). 개인 식별 없음.
  const visibleCards = cards.filter((c) => c.moderationState === 'visible')
  const totalVotes = visibleCards.reduce((sum, c) => sum + c.total, 0)
  const expectedVotes = parts.length * visibleCards.length
  const voteProgress = expectedVotes > 0 ? Math.min(1, totalVotes / expectedVotes) : 0

  // Q1: 근거 유형 분포 — 라운드별·그룹 단위 집계만 서버에서 만들어 내려보낸다.
  // 개별 발언의 evidence_kind 는 카드에 싣지 않는다 (개인 단위 노출 금지). 기여자 k(3) 미만 그룹은 억제됨.
  // 집계 대상은 visible 발언만 (hidden/flagged 제외 — 기존 M-1 원칙과 동일).
  const evidenceByRound = computeEvidenceKindByRound(
    allStatements
      .filter((s) => s.moderation_state === 'visible')
      .map((s) => ({
        statementId: s.id,
        roundId: s.round_id,
        groupId: s.group_id,
        evidenceKind: s.evidence_kind,
        authorParticipantId: s.author_participant_id
      }))
  )

  const activeRound = rounds.find((r) => r.status === 'active') ?? null
  const snaps = await landscape.list(ctx, sessionId)

  // Q2 검토 후보 — **콘솔(operator)에만** 내려보낸다. 참가자/프로젝터 라우트에는 절대 넣지 않는다.
  // moderation 큐와 분리된 별도 필드다 (품질 피드백이 제재로 보이면 안 됨, §3).
  // AI 는 크리티컬 패스가 아니므로 조회 실패해도 콘솔 나머지는 정상 렌더된다.
  const bodyById = new Map(allStatements.map((s) => [s.id, s] as const))
  let aiObservationView: {
    pending: Array<{ id: string; statementId: string; roundId: string | null; kind: string; body: string; suggestedQuestion: string; statementBody: string }>
    approvedCount: number
    rejectedCount: number
  } = { pending: [], approvedCount: 0, rejectedCount: 0 }
  try {
    const all = await aiObservations.list(ctx, sessionId)
    aiObservationView = {
      pending: all
        .filter((o) => o.status === 'pending')
        .map((o) => ({
          id: o.id,
          statementId: o.statement_id,
          roundId: o.round_id,
          kind: o.kind,
          body: o.body,
          suggestedQuestion: o.suggested_question,
          statementBody: bodyById.get(o.statement_id)?.body ?? '(원 발언을 찾을 수 없음)'
        })),
      approvedCount: all.filter((o) => o.status === 'approved').length,
      rejectedCount: all.filter((o) => o.status === 'rejected').length
    }
  } catch (e) {
    console.error(`[delib-console] ai observations unavailable: ${e instanceof Error ? e.name : 'unknown'}`)
  }

  return NextResponse.json({
    ok: true,
    session: { id: session.id, title: session.title, date: session.date },
    rounds,
    activeRound,
    groups: groupViews,
    participantCount: parts.length,
    statements: cards,
    moderationQueue,
    voteProgress: { totalVotes, expectedVotes, ratio: voteProgress },
    // Q1 근거 유형 분포 (라운드별 · 그룹 단위, k-익명 억제 반영). 프로젝터에는 내려보내지 않는다.
    evidenceByRound,
    // 녹음·전사 동의 상태 — 콘솔 "녹음 중" 상시 배너 조건 (transcript-architecture §4).
    recording: readRecordingConsent(session.metadata),
    // Q2 검토 후보 (operator 전용 — 참가자 화면·프로젝터에는 어떤 경로로도 나가지 않는다).
    aiObservations: aiObservationView,
    snapshots: snaps.map((s) => ({ id: s.id, roundId: s.round_id, computedAt: s.computed_at, publishedAt: s.published_at }))
  })
}
