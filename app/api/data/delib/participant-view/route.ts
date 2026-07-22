import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { sessions, delibRounds, delibGroups, statements, votes, participants } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession'
import { toStatementCard } from '@/lib/delib/views'
import { readRecordingConsent } from '@/lib/action/handlers/delib'

// 참가자 모바일 뷰 — 현재 라운드·내 그룹·제출 가능 여부·내가 낸 의견·투표 대상 statement 목록.
// operator 게이트 제외(operatorGate EXEMPT). 신원은 서명된 참가자 쿠키에서만 검증한다.
// 개인 투표 원자료는 "내 표"만 되돌려준다(다른 참가자 표·집계 미노출).
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// §7-1: 참가자 N<12 이면 익명 모드 사실상 무의미 → 비활성 안내.
const ANON_MIN_PARTICIPANTS = 12

// N3: participantCount 세션 캐시 — 개별 폰이 10~15초 간격으로 폴링하므로 매 요청 재집계 부하를 줄인다.
// 단일 노드 런타임(nodejs) 기준 프로세스 메모리 캐시(짧은 TTL). 카운트만 캐시하며 개인 데이터는 캐시하지 않는다.
const PARTICIPANT_COUNT_TTL_MS = 10_000
const participantCountCache = new Map<string, { count: number; expiresAt: number }>()

async function getParticipantCount(ctx: ReturnType<typeof adminContext>, sessionId: string): Promise<number> {
  const cached = participantCountCache.get(sessionId)
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.count
  const count = (await participants.list(ctx, sessionId)).length
  participantCountCache.set(sessionId, { count, expiresAt: now + PARTICIPANT_COUNT_TTL_MS })
  return count
}

// M2: 응답 페이로드 화이트리스트 — 타 참가자 발언/표/집계가 실수로 새어나가지 않도록 스키마로 고정한다.
const StatementCardSchema = z.object({
  id: z.string(),
  body: z.string(),
  groupId: z.string().nullable(),
  roundId: z.string().nullable(),
  moderationState: z.enum(['visible', 'flagged', 'hidden']),
  createdAt: z.string()
})
const ParticipantViewSchema = z.object({
  ok: z.literal(true),
  session: z.object({ id: z.string(), title: z.string(), date: z.string() }),
  participantId: z.string(),
  myGroupId: z.string().nullable(),
  activeRound: z
    .object({ id: z.string(), title: z.string(), mode: z.string(), roundIndex: z.number() })
    .nullable(),
  canSubmit: z.boolean(),
  myStatements: z.array(StatementCardSchema),
  votable: z.array(StatementCardSchema),
  myVotes: z.record(z.enum(['agree', 'disagree', 'pass'])),
  participantCount: z.number(),
  anonymity: z.object({ available: z.boolean(), minParticipants: z.number() }),
  // 녹음·전사 동의 상태 — 참가자 화면 "녹음 중" 상시 배너 조건 (transcript-architecture §4).
  recording: z.object({ active: z.boolean(), consentAt: z.string().nullable() })
})

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

  // M2 방어심층: 쿠키가 유효 서명이라도 participant 가 세션에 실존하는지 재검증한다.
  // (운영자가 참가자를 삭제/폐기했는데 쿠키가 살아있는 경우 → 접근 차단.)
  const me = await participants.findById(ctx, participantId)
  if (!me || me.session_id !== sessionId) {
    return NextResponse.json({ ok: false, error: 'participant no longer valid' }, { status: 403 })
  }

  const [rounds, membership, visibleStatements, myOwnStatements, participantCount] = await Promise.all([
    delibRounds.list(ctx, sessionId),
    delibGroups.findMembershipByParticipant(ctx, participantId),
    // 투표 대상: visible 발언만.
    statements.list(ctx, sessionId, undefined, { visibleOnly: true }),
    // N1: 내가 낸 의견은 flagged/hidden 도 상태와 함께 반환 (자기 모더레이션 인지 — 투명성).
    statements.list(ctx, sessionId),
    getParticipantCount(ctx, sessionId)
  ])
  const myGroupId = membership?.group_id ?? null
  const activeRound = rounds.find((r) => r.status === 'active') ?? null

  // 참가자에게 보이는 발언: public 이거나, 내 그룹 발언이거나, 내가 쓴 발언. (visibleOnly 이미 적용됨)
  const visibleToMe = visibleStatements.filter((s) =>
    s.visibility === 'public' ||
    (s.visibility === 'group' && myGroupId != null && s.group_id === myGroupId) ||
    s.author_participant_id === participantId
  )

  // N1: 내가 낸 의견 (author 기준) — moderation_state 무관하게 본인 발언은 상태와 함께 반환.
  const myStatements = myOwnStatements
    .filter((s) => s.author_participant_id === participantId)
    .map(toStatementCard)
  // 투표 대상 — 활성 라운드가 있으면 그 라운드로 한정, 없으면 전체 visible. 집계(tally) 미포함.
  const votable = visibleToMe
    .filter((s) => (activeRound ? s.round_id === activeRound.id || s.round_id == null : true))
    .map(toStatementCard)

  // 내 표만 조회 — 본인 participantId 로만 (거버넌스 §7-2 안전). statementId → vote 맵.
  const myVoteRows = await votes.listByParticipant(ctx, participantId)
  const myVotes: Record<string, 'agree' | 'disagree' | 'pass'> = {}
  for (const v of myVoteRows) myVotes[v.statement_id] = v.vote

  const anonymityAvailable = participantCount >= ANON_MIN_PARTICIPANTS

  // M2: 반환 직전 화이트리스트 스키마로 파싱 — 정의되지 않은 필드는 전부 제거된다.
  const payload = ParticipantViewSchema.parse({
    ok: true,
    session: { id: session.id, title: session.title, date: session.date },
    participantId,
    myGroupId,
    activeRound: activeRound
      ? { id: activeRound.id, title: activeRound.title, mode: activeRound.mode, roundIndex: activeRound.round_index }
      : null,
    canSubmit: activeRound != null,
    myStatements,
    votable,
    myVotes,
    participantCount,
    anonymity: { available: anonymityAvailable, minParticipants: ANON_MIN_PARTICIPANTS },
    recording: (() => {
      const rc = readRecordingConsent(session.metadata)
      return { active: rc.active, consentAt: rc.consentAt }
    })()
  })

  return NextResponse.json(payload, {
    headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' }
  })
}
