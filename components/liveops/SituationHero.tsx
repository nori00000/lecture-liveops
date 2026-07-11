import { Badge, Card } from '@/components/ui/primitives'
import type { SituationSnapshot } from '@/lib/liveops/types'

type Tone = 'green' | 'yellow' | 'red'
const DOT: Record<Tone, string> = {
  green: 'bg-accent',
  yellow: 'bg-warn',
  red: 'bg-danger'
}

// 0.5초 글랜스용 상황 요약 — 핵심 지표를 색 점(dot)+값 카드로 분리해 한눈에 읽히게 한다.
// 서술형 ai_summary는 보조로 하단에 둔다(과거엔 이게 런온 텍스트로 최상단을 차지).
export function SituationHero({ snapshot }: { snapshot: SituationSnapshot }) {
  const unresolved = snapshot.unresolved_targets.length
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h2 className="text-base font-semibold text-text tracking-tight">현재 상황</h2>
        <Badge tone="info">{snapshot.current_phase}</Badge>
      </div>
      {/* 스크린리더용 — 폴링 갱신 시 요약을 정중히 통지 */}
      <p className="sr-only" role="status" aria-live="polite">{snapshot.ai_summary}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Glance label="위험도" value={labelForRisk(snapshot.risk_level)} tone={toneForRisk(snapshot.risk_level)} emphasis />
        <Glance label="질문" value={labelForLoad(snapshot.question_load)} tone={toneForLoad(snapshot.question_load)} />
        <Glance label="속도" value={labelForSpeed(snapshot.lecture_speed)} tone={toneForSpeed(snapshot.lecture_speed)} />
        <Glance label="미해결" value={`${unresolved}곳`} tone={unresolved > 0 ? 'red' : 'green'} emphasis={unresolved > 0} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
        <Mini title="분위기" body={snapshot.mood_summary} />
        <Mini title="막힘" body={snapshot.blocker_summary} />
        <Mini title="자료" body={snapshot.material_summary} />
      </div>

      <p className="text-xs text-textMute mt-4 leading-6">{snapshot.ai_summary}</p>
    </Card>
  )
}

function Glance({ label, value, tone, emphasis = false }: { label: string; value: string; tone: Tone; emphasis?: boolean }) {
  return (
    <div className={`rounded border bg-bg p-3 ${emphasis && tone === 'red' ? 'border-danger/40' : 'border-border'}`}>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full ${DOT[tone]}`} />
        <span className="text-[11px] text-textMute">{label}</span>
      </div>
      <div className="text-lg font-semibold text-text mt-1.5 leading-tight">{value}</div>
    </div>
  )
}

function Mini({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-border bg-bg/70 p-3">
      <div className="text-xs text-textMute">{title}</div>
      <div className="text-sm text-text mt-1 leading-6">{body}</div>
    </div>
  )
}

function labelForRisk(risk: SituationSnapshot['risk_level']) {
  return risk === 'red' ? '위험' : risk === 'yellow' ? '주의' : '안정'
}
function toneForRisk(risk: SituationSnapshot['risk_level']): Tone {
  return risk === 'red' ? 'red' : risk === 'yellow' ? 'yellow' : 'green'
}
function labelForLoad(load: SituationSnapshot['question_load']) {
  return load === 'high' ? '많음' : load === 'medium' ? '보통' : '낮음'
}
function toneForLoad(load: SituationSnapshot['question_load']): Tone {
  return load === 'high' ? 'red' : load === 'medium' ? 'yellow' : 'green'
}
function labelForSpeed(speed: SituationSnapshot['lecture_speed']) {
  return speed === 'fast' ? '빠름' : speed === 'slow' ? '느림' : '보통'
}
function toneForSpeed(speed: SituationSnapshot['lecture_speed']): Tone {
  return speed === 'normal' ? 'green' : 'yellow'
}
