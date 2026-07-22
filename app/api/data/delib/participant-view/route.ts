import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { sessions, delibRounds, delibGroups, statements, votes, participants } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession'
import { toStatementCard } from '@/lib/delib/views'
import type { VoteValue } from '@/lib/db/schema'

// 참가자 모바일 뷰 — 현재 라운드·내 그룹·제출 가능 여부·내가 낸 의견·투표 대상 statement 목록.
// operator 게이트 제외(operatorGate EXEMPT). 신원은 서명된 참가자 쿠키에서만 검증한다.
// 개인 투표 원자료는 "내 표"만 되돌려준다(다른 참가자 표·집계 미노출).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// §7-1: 참가자 N<12 이면 익명 모드 사실상 무의미 → 비활성 안내.
const ANON_MIN_PARTICIPANTS = 12

export async function GET() {
  const cookieStore = await cookies()
  const ps = readParticipantSession(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value)
  if (!ps) return NextResponse.json({ ok: false, error: 'participant session required' }, { status: 401 })
  if (!ps.participantId) return NextResponse.json({ ok: false, error: 'participant identity missing' }, { status: 403 })

  const sessionId = ps.sessionId
  const participantId = ps.participantId
  // 서버 신뢰 경로 — 쿠키로 검증된 세션/참가자에 한해 adminContext 로 읽고 본인 스코프만 반환한다.
  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const [rounds, membership, allStatements, allParticipants] = await Promise.all([
    delibRounds.list(ctx, sessionId),
    delibGroups.findMembershipByParticipant(ctx, participantId),
    statements.list(ctx, sessionId, undefined, { visibleOnly: true }),
    // 익명 임계 판정용 카운트 — 참가자 목록 길이만 사용.
    participants.list(ctx, sessionId)
  ])
  const myGroupId = membership?.group_id ?? null
  const activeRound = rounds.find((r) => r.status === 'active') ?? null

  // 참가자에게 보이는 발언: public 이거나, 내 그룹 발언이거나, 내가 쓴 발언. (visibleOnly 이미 적용됨)
  const visibleToMe = allStatements.filter((s) =>
    s.visibility === 'public' ||
    (s.visibility === 'group' && myGroupId != null && s.group_id === myGroupId) ||
    s.author_participant_id === participantId
  )

  // 내가 낸 의견 (author 기준). 투표 대상은 내가 쓰지 않은 것도 포함.
  const myStatements = visibleToMe
    .filter((s) => s.author_participant_id === participantId)
    .map(toStatementCard)
  // 투표 대상 — 활성 라운드가 있으면 그 라운드로 한정, 없으면 전체 visible. 집계(tally) 미포함.
  const votable = visibleToMe
    .filter((s) => (activeRound ? s.round_id === activeRound.id || s.round_id == null : true))
    .map(toStatementCard)

  // 내 표만 조회 — 본인 participantId 로만 (거버넌스 §7-2 안전). statementId → vote 맵.
  const myVoteRows = await votes.listByParticipant(ctx, participantId)
  const myVotes: Record<string, VoteValue> = {}
  for (const v of myVoteRows) myVotes[v.statement_id] = v.vote

  const participantCount = allParticipants.length
  const anonymityAvailable = participantCount >= ANON_MIN_PARTICIPANTS

  return NextResponse.json(
    {
      ok: true,
      session: { id: session.id, title: session.title, date: session.date },
      participantId,
      myGroupId,
      activeRound: activeRound ? { id: activeRound.id, title: activeRound.title, mode: activeRound.mode, roundIndex: activeRound.round_index } : null,
      canSubmit: activeRound != null,
      myStatements,
      votable,
      myVotes,
      participantCount,
      anonymity: { available: anonymityAvailable, minParticipants: ANON_MIN_PARTICIPANTS }
    },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
