// Lecture LiveOps — notify common types (P2-2)

export type NotifyChannel = 'email' | 'sms'

export type NotifyEvent =
  | 'access_key_issued'
  | 'qna_answered'
  | 'signal_raised'
  | 'export_completed'
  | 'practice_ticket_critical'

export type NotifyMessage = {
  channel: NotifyChannel
  to: string // 이메일 또는 전화번호
  subject?: string // email
  body: string
  meta?: Record<string, unknown>
}

export type NotifyResult = {
  ok: boolean
  provider: string
  id?: string // provider message id
  error?: string
  // dev fallback (key 없을 때 console에 출력했음을 표시)
  fallback?: boolean
}

export interface NotifyAdapter {
  channel: NotifyChannel
  enabled(): boolean
  send(msg: NotifyMessage): Promise<NotifyResult>
}

// to 식별자 — receiver 1명에 대해 channel별 주소.
export type NotifyRecipient = {
  email?: string
  phone?: string // E.164 권장 (+82...)
  // raw 식별자는 ledger에 hash로만 저장
}

// notify_settings 행
export type NotifySetting = {
  id: string
  session_id: string | null // null = 전역 default
  event_type: NotifyEvent
  channel: NotifyChannel
  enabled: boolean
  created_at: string
  updated_at: string
}
