// Lecture LiveOps — event hooks for notify (P2-2)
// handler 끝에서 fire-and-forget 호출. 실패는 ledger + log.warn, 본 작업 차단 X.

import { notify } from './dispatcher'
import { ledger } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { log } from '@/lib/log'
import { getNeonOwnerSql } from '@/lib/db/neon'
import type { NotifyEvent, NotifyRecipient, NotifyResult } from './types'

async function adminRecipients(): Promise<NotifyRecipient[]> {
  // P2-1 next_auth.users 에서 role='admin' 또는 'instructor' 이메일 조회.
  // owner role 사용 (server-internal).
  try {
    const sql = getNeonOwnerSql()
    const rows = (await sql`select email from next_auth.users where role in ('admin','instructor') and email is not null limit 20`) as Array<{ email: string }>
    return rows.map((r) => ({ email: r.email }))
  } catch (e) {
    log.warn('notify.admin_recipients.error', { error: e instanceof Error ? e.message : String(e) })
    return []
  }
}

async function recordLedger(event: NotifyEvent, sessionId: string | null, results: NotifyResult[]): Promise<void> {
  try {
    const summary = results.map((r) => `${r.provider}=${r.ok ? (r.fallback ? 'fallback' : 'ok') : 'fail'}`).join(',') || 'no-channel'
    await ledger.insert(adminContext(sessionId ?? undefined), {
      session_id: sessionId,
      actor_type: 'system',
      actor_role: 'admin',
      tool: 'web-ui',
      action_name: `notify.${event}`,
      input_hash: hashShort(event + ':' + Date.now()),
      input_redacted_summary: `[notify] ${summary}`.slice(0, 200),
      output_summary: `channels=${results.length} ok=${results.filter((r) => r.ok).length}`,
      status: results.every((r) => r.ok) ? 'ok' : 'error'
    })
  } catch (e) {
    // ledger 충돌 (idempotency) 도 가능 — 무시
    log.warn('notify.ledger.error', { error: e instanceof Error ? e.message : String(e) })
  }
}

function hashShort(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return 'n' + Math.abs(h).toString(36)
}

// ===== hook entry points =====

export async function onAccessKeyIssued(opts: { sessionId: string; participantEmail?: string; participantPhone?: string; sessionTitle?: string }): Promise<void> {
  if (!opts.participantEmail && !opts.participantPhone) return
  try {
    const body = `${opts.sessionTitle ?? '강의'} 접속 코드가 발급되었습니다. 별도로 전달된 입장 안내를 확인해 주세요.`
    const results = await notify({
      event: 'access_key_issued',
      to: { email: opts.participantEmail, phone: opts.participantPhone },
      body
    })
    await recordLedger('access_key_issued', opts.sessionId, results)
  } catch (e) {
    log.warn('notify.access_key_issued.error', { error: e instanceof Error ? e.message : String(e) })
  }
}

export async function onQnaAnswered(opts: { sessionId: string; questionerEmail?: string; questionerPhone?: string; preview?: string }): Promise<void> {
  if (!opts.questionerEmail && !opts.questionerPhone) return
  try {
    const body = `보낸 질문에 답변이 등록되었습니다. 미리보기: ${(opts.preview ?? '').slice(0, 80)}`
    const results = await notify({
      event: 'qna_answered',
      to: { email: opts.questionerEmail, phone: opts.questionerPhone },
      body
    })
    await recordLedger('qna_answered', opts.sessionId, results)
  } catch (e) {
    log.warn('notify.qna_answered.error', { error: e instanceof Error ? e.message : String(e) })
  }
}

export async function onSignalRaised(opts: { sessionId: string; signalType: string; tableLabel?: string }): Promise<void> {
  try {
    const recipients = await adminRecipients()
    if (recipients.length === 0) return
    const body = `운영 신호 발생: ${opts.signalType}${opts.tableLabel ? ` (테이블 ${opts.tableLabel})` : ''}`
    const all: NotifyResult[] = []
    for (const r of recipients) {
      const results = await notify({ event: 'signal_raised', to: r, body })
      all.push(...results)
    }
    await recordLedger('signal_raised', opts.sessionId, all)
  } catch (e) {
    log.warn('notify.signal_raised.error', { error: e instanceof Error ? e.message : String(e) })
  }
}

export async function onExportCompleted(opts: { sessionId: string; profile: string; formats: string[]; requesterEmail?: string }): Promise<void> {
  if (!opts.requesterEmail) {
    // requester 미상 시 admin 전체에 발송
    try {
      const recipients = await adminRecipients()
      const body = `세션 아카이브가 생성되었습니다. profile=${opts.profile} formats=${opts.formats.join(',')}`
      const all: NotifyResult[] = []
      for (const r of recipients) {
        const results = await notify({ event: 'export_completed', to: r, body })
        all.push(...results)
      }
      await recordLedger('export_completed', opts.sessionId, all)
    } catch (e) {
      log.warn('notify.export_completed.error', { error: e instanceof Error ? e.message : String(e) })
    }
    return
  }
  try {
    const body = `세션 아카이브가 생성되었습니다. profile=${opts.profile} formats=${opts.formats.join(',')}`
    const results = await notify({ event: 'export_completed', to: { email: opts.requesterEmail }, body })
    await recordLedger('export_completed', opts.sessionId, results)
  } catch (e) {
    log.warn('notify.export_completed.error', { error: e instanceof Error ? e.message : String(e) })
  }
}
