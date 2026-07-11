// Lecture LiveOps — Twilio SMS adapter (P2-2, 폴백)
// 카카오 알림톡 미설정 또는 실패 시 폴백.
// env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
// 키 없으면 dev fallback.

import { log } from '@/lib/log'
import type { NotifyAdapter, NotifyResult, NotifyMessage } from './types'

function cfg() {
  return {
    sid: process.env.TWILIO_ACCOUNT_SID,
    token: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM
  }
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return 'h' + Math.abs(h).toString(36)
}

export const smsAdapter: NotifyAdapter = {
  channel: 'sms',
  enabled(): boolean {
    const c = cfg()
    return Boolean(c.sid && c.token && c.from)
  },
  async send(msg: NotifyMessage): Promise<NotifyResult> {
    const c = cfg()
    if (!c.sid || !c.token || !c.from) {
      log.warn('notify.sms.fallback', { to_hash: hash(msg.to) })
      return { ok: true, provider: 'twilio-sms', fallback: true, id: 'dev-' + Date.now().toString(36) }
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(c.sid)}/Messages.json`
    const auth = 'Basic ' + Buffer.from(`${c.sid}:${c.token}`).toString('base64')
    const form = new URLSearchParams({ From: c.from, To: msg.to, Body: msg.body })
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
        body: form.toString()
      })
      const body = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number }
      if (res.ok && body.sid) {
        return { ok: true, provider: 'twilio-sms', id: body.sid }
      }
      const err = body.message ?? `http_${res.status}`
      log.error('notify.sms.error', { to_hash: hash(msg.to), code: body.code, error: err })
      return { ok: false, provider: 'twilio-sms', error: err }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'send_failed'
      log.error('notify.sms.error', { to_hash: hash(msg.to), error: message })
      return { ok: false, provider: 'twilio-sms', error: message }
    }
  }
}
