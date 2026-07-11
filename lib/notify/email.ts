// Lecture LiveOps — Resend email adapter (P2-2)
// AUTH_RESEND_KEY (P2-1)와 RESEND_API_KEY를 모두 인식. 둘 다 없으면 dev fallback (stderr).

import { Resend } from 'resend'
import { log } from '@/lib/log'
import type { NotifyAdapter, NotifyResult, NotifyMessage } from './types'

let cachedKey: string | undefined
let cachedClient: Resend | null = null

function getKey(): string | undefined {
  if (cachedKey !== undefined) return cachedKey
  cachedKey = process.env.RESEND_API_KEY ?? process.env.AUTH_RESEND_KEY
  return cachedKey
}

function getFrom(): string {
  return process.env.NOTIFY_EMAIL_FROM ?? process.env.AUTH_EMAIL_FROM ?? 'noreply@localhost'
}

function getClient(): Resend | null {
  if (cachedClient) return cachedClient
  const key = getKey()
  if (!key) return null
  try {
    cachedClient = new Resend(key)
    return cachedClient
  } catch {
    return null
  }
}

export function resetEmailAdapterForTest(): void {
  cachedKey = undefined
  cachedClient = null
}

export const emailAdapter: NotifyAdapter = {
  channel: 'email',
  enabled(): boolean {
    return Boolean(getKey())
  },
  async send(msg: NotifyMessage): Promise<NotifyResult> {
    const client = getClient()
    if (!client) {
      log.warn('notify.email.fallback', { to_hash: hash(msg.to), subject: msg.subject ?? '' })
      return { ok: true, provider: 'resend', fallback: true, id: 'dev-' + Date.now().toString(36) }
    }
    try {
      const r = await client.emails.send({
        from: getFrom(),
        to: [msg.to],
        subject: msg.subject ?? '(no subject)',
        html: escapeHtml(msg.body)
      })
      const id = r.data?.id
      return { ok: true, provider: 'resend', id }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'send_failed'
      log.error('notify.email.error', { to_hash: hash(msg.to), error: message })
      return { ok: false, provider: 'resend', error: message }
    }
  }
}

function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return 'h' + Math.abs(h).toString(36)
}

function escapeHtml(s: string): string {
  // body가 이미 HTML이면 그대로, 아니면 plain → <pre> wrap
  if (/<[a-z][\s\S]*>/i.test(s)) return s
  return `<div style="font-family:Pretendard,system-ui,sans-serif;font-size:14px;line-height:1.6;color:#1B1B1F">${s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />')}</div>`
}
