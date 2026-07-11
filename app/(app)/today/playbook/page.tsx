'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Badge, Button, PageHeader } from '@/components/ui/primitives'
import { SIGNAL_LABEL } from '@/components/seatmap/SignalStrip'

const SIGNALS = [
  { id: 'speed_down', label: '속도 늦추기', sop: '지난 5분 진도를 한 번 정리 후 다음 챕터로' },
  { id: 'break_needed', label: '쉬는 시간 필요', sop: '5분 휴식 안내, 운영팀 음료 점검' },
  { id: 'question_surge', label: '질문 폭주', sop: '메인 강사 답변 모드, 보조강사 분류' },
  { id: 'practice_blocked', label: '실습 막힘', sop: '해당 테이블 즉시 배정, 환경 점검' },
  { id: 'lunch_delay', label: '점심시간 지연', sop: '식사 배달 컨택, 진행자 안내' },
  { id: 'network', label: '네트워크 장애', sop: '핫스팟 활성화, 오프라인 자료 배포' },
  { id: 'mood_drop', label: '분위기 저하', sop: '짧은 사례 공유로 환기, 활동 삽입' }
] as const

// 좌석맵(SignalStrip)과 동일한 한국어 라벨/로컬 시각 표기로 통일
function signalLabel(signalType: string): string {
  return (SIGNAL_LABEL as Record<string, string>)[signalType] ?? signalType
}

function formatSignalTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

export default function PlaybookPage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; signals?: { id: string; signal_type: string; created_at: string; note: string; acknowledged_at?: string | null }[] }>('/api/data/session')
  const session = data?.session
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(signalType: typeof SIGNALS[number]['id']) {
    if (!session) return
    const label = SIGNALS.find((s) => s.id === signalType)?.label ?? signalType
    try {
      const r = await invoke({
        action: 'liveops.send_assistant_signal',
        role: 'assistant',
        scope: { sessionId: session.id },
        input: { sessionId: session.id, signalType, note: '' }
      })
      if (r && (r.ok === false || r.error)) {
        setNotice({ ok: false, text: `${label} 신호 발송 실패 — 다시 시도해 주세요` })
        return
      }
      setNotice({ ok: true, text: `${label} 신호를 보냈습니다` })
      mutate()
    } catch {
      setNotice({ ok: false, text: '전송 실패 — 연결을 확인해 주세요' })
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="보조강사 플레이북" desc="상황별 신호 버튼과 표준 운영 절차" />
      {notice ? (
        <p role="status" className={'mb-3 text-sm ' + (notice.ok ? 'text-accent' : 'text-danger')}>{notice.text}</p>
      ) : null}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
        {SIGNALS.map((s) => (
          <Card key={s.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">{s.label}</div>
              <Badge tone="warn">{s.id}</Badge>
            </div>
            <p className="text-xs text-textDim mb-3 leading-relaxed">{s.sop}</p>
            <Button variant="accent" onClick={() => send(s.id)}>신호 발송</Button>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="최근 신호" hint={`${data?.signals?.length ?? 0}건`} />
        <ul className="divide-y divide-border">
          {(data?.signals ?? []).slice(0, 12).map((sg) => (
            <li key={sg.id} className="px-4 py-2 text-sm flex items-center gap-3">
              <span className="text-xs text-textMute w-20 shrink-0">{formatSignalTime(sg.created_at)}</span>
              <Badge tone="warn">{signalLabel(sg.signal_type)}</Badge>
              <span className="text-textDim">{sg.note || '—'}</span>
              {sg.acknowledged_at ? (
                <span className="ml-auto text-xs text-accent whitespace-nowrap">확인됨 {formatSignalTime(sg.acknowledged_at)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
