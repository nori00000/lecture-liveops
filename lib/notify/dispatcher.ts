// Lecture LiveOps — notify dispatcher (P2-2)
// 채널 자동 선택 + Promise.allSettled (1 채널 실패가 다른 채널 차단 X).
// 이메일 주소와 전화번호가 있으면 각각 독립적으로 발송한다.

import { emailAdapter } from './email'
import { smsAdapter } from './sms'
import type { NotifyAdapter, NotifyEvent, NotifyRecipient, NotifyResult } from './types'

export const ADAPTERS: NotifyAdapter[] = [emailAdapter, smsAdapter]

export type NotifyDispatchInput = {
  event: NotifyEvent
  to: NotifyRecipient
  body: string
  subject?: string
}

export async function notify(input: NotifyDispatchInput): Promise<NotifyResult[]> {
  const tasks: Promise<NotifyResult>[] = []

  // 이메일: 주소 있고 어댑터 사용 가능 (fallback 포함)할 때 항상 발송
  if (input.to.email) {
    tasks.push(
      emailAdapter.send({
        channel: 'email',
        to: input.to.email,
        subject: input.subject ?? defaultSubject(input.event),
        body: input.body,
        meta: { event: input.event }
      })
    )
  }

  // 전화번호는 공급자 중립 SMS 어댑터로 발송
  if (input.to.phone) {
    tasks.push(
      smsAdapter.send({
        channel: 'sms',
        to: input.to.phone,
        body: input.body,
        meta: { event: input.event }
      })
    )
  }

  const settled = await Promise.allSettled(tasks)
  return settled.map((s) => (s.status === 'fulfilled' ? s.value : { ok: false, provider: 'dispatcher', error: String(s.reason ?? 'rejected') }))
}

function defaultSubject(event: NotifyEvent): string {
  switch (event) {
    case 'access_key_issued':
      return '[Lecture LiveOps] 강의 접속 코드가 발급되었습니다'
    case 'qna_answered':
      return '[Lecture LiveOps] 보낸 질문에 답변이 등록되었습니다'
    case 'signal_raised':
      return '[Lecture LiveOps] 운영 신호가 발생했습니다'
    case 'export_completed':
      return '[Lecture LiveOps] 세션 아카이브가 생성되었습니다'
    case 'practice_ticket_critical':
      return '[Lecture LiveOps] 실습 지원 요청 (긴급)'
    default:
      return '[Lecture LiveOps] 알림'
  }
}
