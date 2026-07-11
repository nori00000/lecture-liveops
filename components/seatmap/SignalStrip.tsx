'use client'

import { useEffect, useRef, useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card } from '@/components/ui/primitives'
import type { SessionSignal, SignalType } from './types'

export const SIGNAL_LABEL: Record<SignalType, string> = {
  speed_down: '속도 늦추기',
  break_needed: '쉬는 시간 필요',
  question_surge: '질문 폭주',
  practice_blocked: '실습 막힘',
  lunch_delay: '점심시간 지연',
  network: '네트워크 장애',
  mood_drop: '분위기 저하'
}

const SIGNAL_BUTTONS: SignalType[] = ['speed_down', 'question_surge', 'practice_blocked', 'network']

export function SignalStrip({ sessionId, large = false }: { sessionId: string; large?: boolean }) {
  const { data, mutate } = useSessionData<{ signals?: SessionSignal[] }>('/api/data/session')
  const sender = useSignalSender(sessionId, () => void mutate())
  const recent = (data?.signals ?? []).slice(0, 3)
  const ack = useSignalAck(sessionId, () => void mutate())

  return (
    <>
      <Card className="hidden md:flex px-4 py-3 flex-col gap-2">
        <SignalBody sender={sender} recent={recent} large={large} mobile={false} ack={ack} canAck={large} />
      </Card>
      <details className="md:hidden group bg-surface border border-border rounded-md">
        <summary className="list-none [&::-webkit-details-marker]:hidden min-h-[44px] px-3 flex items-center gap-2 cursor-pointer select-none">
          <span className="text-sm font-medium text-text shrink-0">강사 신호</span>
          <SignalPreview signal={recent[0] ?? null} />
          <Chevron />
        </summary>
        <div className="px-3 pb-3 pt-2 border-t border-border flex flex-col gap-2">
          <SignalBody sender={sender} recent={recent} large={large} mobile ack={ack} canAck={large} />
        </div>
      </details>
    </>
  )
}

type Sender = ReturnType<typeof useSignalSender>

function SignalBody({
  sender,
  recent,
  large,
  mobile,
  ack,
  canAck
}: {
  sender: Sender
  recent: SessionSignal[]
  large: boolean
  mobile: boolean
  ack: Ack
  canAck: boolean
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {!mobile ? <span className="text-xs text-textMute shrink-0">강사 신호</span> : null}
        {SIGNAL_BUTTONS.map((t) => (
          <button
            key={t}
            type="button"
            disabled={sender.sending !== null}
            onClick={() => sender.send(t)}
            className={
              'rounded border border-border bg-surfaceAlt text-textDim transition-colors ' +
              'hover:text-text hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed ' +
              (large || mobile ? 'px-4 py-2 min-h-[44px] text-sm font-medium' : 'px-3 py-1.5 min-h-[36px] text-xs')
            }
          >
            {SIGNAL_LABEL[t]}
          </button>
        ))}
        <span role="status" aria-live="polite" className="text-xs text-accent">
          {sender.sentLabel}
        </span>
      </div>
      <RecentSignals signals={recent} large={large} ack={ack} canAck={canAck} />
    </>
  )
}

/** 접힌 summary에 최근 신호 1건 미리보기 — 없으면 안내 문구. */
function SignalPreview({ signal }: { signal: SessionSignal | null }) {
  if (!signal) {
    return <span className="flex-1 min-w-0 text-xs text-textMute truncate">최근 신호 없음</span>
  }
  return (
    <span className="flex-1 min-w-0 text-xs text-textDim truncate">
      <span className="text-textMute">{formatSignalTime(signal.created_at)}</span>{' '}
      {SIGNAL_LABEL[signal.signal_type] ?? signal.signal_type}
    </span>
  )
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      className="w-3 h-3 shrink-0 text-textMute transition-transform group-open:rotate-180"
    >
      <path d="M 2 4 L 6 8.2 L 10 4" stroke="currentColor" strokeWidth={1.4} fill="none" strokeLinecap="round" />
    </svg>
  )
}

function useSignalSender(sessionId: string, onSent: () => void) {
  const [sending, setSending] = useState<SignalType | null>(null)
  const [sentLabel, setSentLabel] = useState('')
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  async function send(signalType: SignalType) {
    setSending(signalType)
    try {
      await invoke({
        action: 'liveops.send_assistant_signal',
        role: 'assistant',
        scope: { sessionId },
        input: { sessionId, signalType }
      })
      setSentLabel(`${SIGNAL_LABEL[signalType]} 전송됨 · ${formatClock(new Date())}`)
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setSentLabel(''), 4000)
      onSent()
    } finally {
      setSending(null)
    }
  }

  return { sending, sentLabel, send }
}

function RecentSignals({
  signals,
  large,
  ack,
  canAck
}: {
  signals: SessionSignal[]
  large: boolean
  ack: Ack
  canAck: boolean
}) {
  if (signals.length === 0) {
    return <div className="text-xs text-textMute">최근 신호가 없습니다.</div>
  }
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {signals.map((s) => (
        <li key={s.id} className={(large ? 'text-sm' : 'text-xs') + ' text-textDim flex items-center gap-2'}>
          <span>
            <span className="text-textMute">{formatSignalTime(s.created_at)}</span>{' '}
            <span className="font-medium">{SIGNAL_LABEL[s.signal_type] ?? s.signal_type}</span>
            {s.note ? <span className="text-textMute"> — {s.note}</span> : null}
          </span>
          {s.acknowledged_at ? (
            <span className="text-accent whitespace-nowrap">확인됨 {formatSignalTime(s.acknowledged_at)}</span>
          ) : canAck ? (
            <button
              type="button"
              disabled={ack.acking === s.id}
              onClick={() => ack.acknowledge(s.id)}
              className="rounded border border-border bg-surfaceAlt px-2 py-1 min-h-[32px] text-xs text-textDim hover:text-text hover:bg-border disabled:opacity-40"
            >
              확인
            </button>
          ) : (
            <span className="text-textMute whitespace-nowrap">미확인</span>
          )}
        </li>
      ))}
    </ul>
  )
}

type Ack = ReturnType<typeof useSignalAck>

// 강사가 신호를 확인 — 퍼실리테이터 화면에 "확인됨"으로 동기화 (수신 불안 제거)
function useSignalAck(sessionId: string, onDone: () => void) {
  const [acking, setAcking] = useState<string | null>(null)

  async function acknowledge(signalId: string) {
    setAcking(signalId)
    try {
      await invoke({
        action: 'liveops.acknowledge_signal',
        role: 'assistant',
        scope: { sessionId },
        input: { signalId }
      })
      onDone()
    } finally {
      setAcking(null)
    }
  }

  return { acking, acknowledge }
}

function formatSignalTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
