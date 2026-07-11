import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { AxActionEnvelopeSchema, type AxActionResult } from '@/lib/action/envelope'
import { CATALOG } from '@/lib/action/catalog'
import { isAllowed } from '@/lib/action/permissions'
import { getCached, setCached } from '@/lib/action/idempotency'
import { hashInput, redactInput } from '@/lib/action/redact'
import { ledger } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession'
import { OPERATOR_COOKIE, isOperatorGateEnabled, verifyOperatorCookie } from '@/lib/security/operatorGate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ ok: true, catalog: Object.keys(CATALOG) })
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, status: 'invalid', error: 'invalid json' }, { status: 400 })
  }

  const parsed = AxActionEnvelopeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, status: 'invalid', error: 'envelope schema fail', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const env = parsed.data
  const handler = CATALOG[env.action]
  if (!handler) {
    return NextResponse.json(
      { ok: false, status: 'invalid', error: 'unknown action: ' + env.action },
      { status: 400 }
    )
  }

  if (env.actor.role === 'participant') {
    const cookieStore = await cookies()
    const participantSession = readParticipantSession(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value)
    if (!participantSession || env.scope.sessionId !== participantSession.sessionId) {
      return NextResponse.json({ ok: false, status: 'denied', error: 'participant session required' } satisfies AxActionResult, { status: 403 })
    }
  } else if (isOperatorGateEnabled()) {
    // 운영자 role(admin/instructor/assistant)은 게이트 활성 시 operator 쿠키 필수.
    const cookieStore = await cookies()
    if (!verifyOperatorCookie(cookieStore.get(OPERATOR_COOKIE)?.value)) {
      return NextResponse.json(
        { ok: false, status: 'denied', error: 'operator key required' } satisfies AxActionResult,
        { status: 401 }
      )
    }
  }

  if (!isAllowed(env.action, env.actor.role)) {
    const summary = redactInput(env.input, 'metadata-only')
    let denyId = 'no-ledger'
    try {
      const row = await ledger.insert(adminContext(env.scope.sessionId ?? undefined), {
        session_id: env.scope.sessionId ?? null,
        actor_type: env.actor.type,
        actor_role: env.actor.role,
        tool: env.actor.tool ?? 'web-ui',
        action_name: env.action,
        input_hash: hashInput(env.input),
        input_redacted_summary: `[denied] ${summary}`.slice(0, 200),
        output_summary: `denied for role ${env.actor.role}`,
        status: 'denied'
      })
      denyId = row.id
    } catch {
      // ledger 충돌 무시
    }
    const res: AxActionResult = { ok: false, status: 'denied', error: 'permission denied', ledger_id: denyId }
    return NextResponse.json(res, { status: 403 })
  }

  const cached = getCached(env.action, env.idempotencyKey)
  if (cached) return NextResponse.json(cached, { status: 200 })

  const input_hash = hashInput(env.input)
  const input_redacted_summary = redactInput(env.input, env.redactionPolicy).slice(0, 200)

  try {
    if (env.dryRun) {
      const summary = `[dry_run] action=${env.action} role=${env.actor.role}`
      let dryId: string | undefined
      try {
        const row = await ledger.insert(adminContext(env.scope.sessionId ?? undefined), {
          session_id: env.scope.sessionId ?? null,
          actor_type: env.actor.type,
          actor_role: env.actor.role,
          tool: env.actor.tool ?? 'web-ui',
          action_name: env.action,
          input_hash,
          input_redacted_summary,
          output_summary: summary,
          status: 'dry_run'
        })
        dryId = row.id
      } catch (e) {
        if (!/duplicate|23505|already exists/i.test(e instanceof Error ? e.message : '')) throw e
        dryId = 'cached'
      }
      const res: AxActionResult = { ok: true, status: 'dry_run', data: { dryRun: true, action: env.action }, ledger_id: dryId }
      setCached(env.action, env.idempotencyKey, res)
      return NextResponse.json(res, { status: 200 })
    }

    const out = await handler({ envelope: env })
    let ledgerId: string | undefined
    try {
      const row = await ledger.insert(adminContext(env.scope.sessionId ?? undefined), {
        session_id: env.scope.sessionId ?? null,
        actor_type: env.actor.type,
        actor_role: env.actor.role,
        tool: env.actor.tool ?? 'web-ui',
        action_name: env.action,
        input_hash,
        input_redacted_summary,
        output_summary: (out.summary ?? '').slice(0, 200),
        status: 'ok'
      })
      ledgerId = row.id
    } catch (e) {
      // unique constraint (idempotency) 위반은 cached treatment
      const msg = e instanceof Error ? e.message : ''
      if (!/duplicate|23505|already exists/i.test(msg)) throw e
      ledgerId = 'cached'
    }
    const res: AxActionResult = { ok: true, status: 'ok', data: out.data, ledger_id: ledgerId }
    setCached(env.action, env.idempotencyKey, res)
    return NextResponse.json(res, { status: 200 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'handler error'
    let row: { id: string } = { id: 'no-ledger' }
    try {
      row = await ledger.insert(adminContext(env.scope.sessionId ?? undefined), {
        session_id: env.scope.sessionId ?? null,
        actor_type: env.actor.type,
        actor_role: env.actor.role,
        tool: env.actor.tool ?? 'web-ui',
        action_name: env.action,
        input_hash,
        input_redacted_summary,
        output_summary: msg.slice(0, 200),
        status: 'error'
      })
    } catch {
      // ledger insert도 실패하면 그냥 진행 (DB unique 충돌)
    }
    return NextResponse.json(
      { ok: false, status: 'error', error: msg, ledger_id: row.id } satisfies AxActionResult,
      { status: 500 }
    )
  }
}
