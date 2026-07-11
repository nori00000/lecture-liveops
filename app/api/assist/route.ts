// Lecture LiveOps — 자연어 명령 → 좌석 액션 API (트랙 A)
// POST { sessionId, text } → 결정론 파서(즉답) → 실패 시 트랙 B LLM fallback → 실행.
// 실행은 /api/action 과 동일하게 CATALOG 핸들러 직접 호출(내부 envelope 구성) + ledger 기록.
// 주의: /api/assist 는 isOperatorProtectedPath 비포함 — operator 게이트를 자체 검사한다.
// rate limit / CSRF / origin 검사는 기존 middleware 가 처리.

import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AxActionEnvelopeSchema, type AxActionEnvelope } from '@/lib/action/envelope'
import { CATALOG } from '@/lib/action/catalog'
import { hashInput, redactInput } from '@/lib/action/redact'
import { ledger, seatLayouts, seatMarks } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { OPERATOR_COOKIE, isOperatorGateEnabled, verifyOperatorCookie } from '@/lib/security/operatorGate'
import { parseCommand, REASON_LABEL_KO } from '@/lib/seatmap/command-parser'
import { runLlmFallback } from '@/lib/assist/llm'
import type { AssistPlan } from '@/lib/assist/types'
import { newId } from '@/lib/util/id'
import type { SeatMark } from '@/lib/db/schema'

export const maxDuration = 30
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const BodySchema = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(500)
})

const HELP = "해석 실패 — 예: '14 15 문제', '3조 2번 해결 설치였음'"

export async function POST(req: Request) {
  const denied = await checkOperatorGate()
  if (denied) return denied

  const body = BodySchema.safeParse(await req.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ ok: false, message: 'sessionId와 text가 필요합니다' }, { status: 400 })
  }
  const { sessionId, text } = body.data

  const layout = await seatLayouts.getBySession(adminContext(sessionId), sessionId)
  if (!layout) {
    return NextResponse.json({ ok: false, message: '배치도가 없습니다 — 레이아웃을 먼저 등록해 주세요' }, { status: 400 })
  }
  const seatKeys = layout.layout.tables.flatMap((t) => t.seats.map((s) => s.key))

  const plan = await resolvePlan(text, sessionId, seatKeys)
  if (!plan) {
    return NextResponse.json({ ok: false, message: HELP }, { status: 400 })
  }
  if (plan.intent !== 'clear' && plan.seatKeys.length === 0) {
    const list = plan.unmatched.join(', ')
    const message = list ? `좌석을 찾지 못했습니다: ${list} — ${HELP}` : HELP
    return NextResponse.json({ ok: false, message, unmatched: plan.unmatched }, { status: 400 })
  }

  try {
    const message = await executePlan(plan, sessionId)
    await recordLedger(sessionId, text, plan, message)
    return NextResponse.json({
      ok: true,
      applied: { intent: plan.intent, seatKeys: plan.seatKeys, reason: plan.reason, memo: plan.memo },
      message
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'assist execution failed'
    return NextResponse.json({ ok: false, message: msg }, { status: 500 })
  }
}

/** 운영자 게이트 — 현재 OFF 기본이지만 활성 시 operator 쿠키 필수 (401). */
async function checkOperatorGate(): Promise<NextResponse | null> {
  if (!isOperatorGateEnabled()) return null
  const cookieStore = await cookies()
  if (verifyOperatorCookie(cookieStore.get(OPERATOR_COOKIE)?.value)) return null
  return NextResponse.json({ ok: false, message: 'operator key required' }, { status: 401 })
}

/** 결정론 파서 우선, null이면 트랙 B LLM fallback(실패 무해화) + seatKeys allowlist 재검증. */
async function resolvePlan(text: string, sessionId: string, seatKeys: string[]): Promise<AssistPlan | null> {
  const parsed = parseCommand(text, seatKeys)
  if (parsed) return parsed
  try {
    const llm = await runLlmFallback({ text, sessionId, seatKeys })
    if (!llm) return null
    const valid = new Set(seatKeys)
    return { ...llm, seatKeys: llm.seatKeys.filter((k) => valid.has(k)) }
  } catch {
    return null
  }
}

/** 계획 실행 — seatMarks upsert + [좌석일지] ops log. 사용자에게 보여줄 message 반환. */
async function executePlan(plan: AssistPlan, sessionId: string): Promise<string> {
  if (plan.intent === 'clear' && plan.seatKeys.length === 0) {
    const out = await runAction('liveops.clear_seat_marks', sessionId, { sessionId })
    const cleared = (out as { cleared?: number } | undefined)?.cleared ?? 0
    return withUnmatched(`좌석 마크 전체 초기화 (${cleared}건)`, plan)
  }

  const existing = await seatMarks.list(adminContext(sessionId), sessionId)
  if (plan.intent === 'clear') {
    for (const key of plan.seatKeys) {
      await runAction('liveops.update_seat_mark', sessionId, { sessionId, seatKey: key, status: 'none' })
    }
    return withUnmatched(`${plan.seatKeys.join(', ')} 마크 해제`, plan)
  }
  if (plan.intent === 'problem') {
    return withUnmatched(await applyProblem(plan, sessionId), plan)
  }
  return withUnmatched(await applyResolved(plan, sessionId, existing), plan)
}

/** 문제 마킹 — 좌석별 upsert + 묶음 ops log 1줄: [좌석일지] 3-2, 3-3 문제 (설치). */
async function applyProblem(plan: AssistPlan, sessionId: string): Promise<string> {
  for (const key of plan.seatKeys) {
    await runAction('liveops.update_seat_mark', sessionId, {
      sessionId,
      seatKey: key,
      status: 'problem',
      ...(plan.reason ? { reason: plan.reason } : {}),
      ...(plan.memo ? { memo: plan.memo } : {})
    })
  }
  const label = plan.reason ? ` (${REASON_LABEL_KO[plan.reason] ?? plan.reason})` : ''
  const memoPart = plan.memo ? ` — ${plan.memo}` : ''
  await appendJournal(sessionId, `[좌석일지] ${plan.seatKeys.join(', ')} 문제${label}${memoPart}`)
  return `${plan.seatKeys.join(', ')} 문제 표시${label}`
}

/** 해결 마킹 — 기존 problem 마크가 있으면 경과분/사유를 좌석별 ops log에 남긴다. */
async function applyResolved(plan: AssistPlan, sessionId: string, existing: SeatMark[]): Promise<string> {
  const now = Date.now()
  for (const key of plan.seatKeys) {
    const prev = existing.find((m) => m.seat_key === key)
    const reason = plan.reason ?? (prev?.reason || undefined)
    const memo = plan.memo ?? (prev?.memo || undefined)
    await runAction('liveops.update_seat_mark', sessionId, {
      sessionId,
      seatKey: key,
      status: 'resolved',
      ...(reason ? { reason } : {}),
      ...(memo ? { memo } : {})
    })
    await appendJournal(sessionId, resolvedJournalLine(key, prev, reason, plan.memo, now))
  }
  return `${plan.seatKeys.join(', ')} 해결 표시`
}

/** 예: [좌석일지] 3-2 해결 (경과 12분, 사유 설치) — SSL이었음. */
function resolvedJournalLine(
  key: string,
  prev: SeatMark | undefined,
  reason: string | undefined,
  memo: string | undefined,
  now: number
): string {
  const reasonPart = reason ? `사유 ${REASON_LABEL_KO[reason] ?? reason}` : ''
  let paren = ''
  if (prev?.status === 'problem' && prev.updated_at) {
    const mins = Math.max(0, Math.round((now - new Date(prev.updated_at).getTime()) / 60_000))
    paren = ` (경과 ${mins}분${reasonPart ? `, ${reasonPart}` : ''})`
  } else if (reasonPart) {
    paren = ` (${reasonPart})`
  }
  return `[좌석일지] ${key} 해결${paren}${memo ? ` — ${memo}` : ''}`
}

async function appendJournal(sessionId: string, line: string): Promise<void> {
  await runAction('liveops.append_ops_log', sessionId, {
    sessionId,
    logType: 'note',
    body: line,
    visibility: 'private'
  })
}

/** /api/action 과 동일한 실행 경로 — CATALOG 핸들러 직접 호출 (fetch 금지, 내부 envelope 구성). */
async function runAction(action: string, sessionId: string, input: unknown): Promise<unknown> {
  const envelope: AxActionEnvelope = AxActionEnvelopeSchema.parse({
    action,
    actor: { type: 'human', role: 'assistant', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: newId('assist'),
    input
  })
  const handler = CATALOG[action]
  if (!handler) throw new Error('unknown action: ' + action)
  const out = await handler({ envelope })
  return out.data
}

/** assist 명령 1건당 ledger 1행 — 개별 액션 행 대신 명령 요약을 남긴다 (실패는 무해화). */
async function recordLedger(sessionId: string, text: string, plan: AssistPlan, message: string): Promise<void> {
  try {
    await ledger.insert(adminContext(sessionId), {
      session_id: sessionId,
      actor_type: 'human',
      actor_role: 'assistant',
      tool: 'web-ui',
      action_name: 'liveops.assist_command',
      input_hash: hashInput({ sessionId, text }),
      input_redacted_summary: redactInput({ text, intent: plan.intent, seatKeys: plan.seatKeys }, 'summary').slice(0, 200),
      output_summary: message.slice(0, 200),
      status: 'ok'
    })
  } catch {
    // ledger 기록 실패(unique 충돌 등)는 명령 결과에 영향 주지 않는다
  }
}

function withUnmatched(message: string, plan: AssistPlan): string {
  if (plan.unmatched.length === 0) return message
  return `${message} · 해석 못함: ${plan.unmatched.join(', ')}`
}
