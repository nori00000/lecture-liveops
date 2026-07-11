import type { MaterialVersion, SituationSnapshot, StructuredObservation } from './types'

function loadLevel(count: number): SituationSnapshot['question_load'] {
  if (count >= 6) return 'high'
  if (count >= 2) return 'medium'
  return 'low'
}

function riskLevel(input: { urgent: number; blockers: number; questionLoad: SituationSnapshot['question_load'] }): SituationSnapshot['risk_level'] {
  if (input.urgent > 0 || input.blockers >= 3 || input.questionLoad === 'high') return 'red'
  if (input.blockers > 0 || input.questionLoad === 'medium') return 'yellow'
  return 'green'
}

function latestSpeed(observations: StructuredObservation[]): SituationSnapshot['lecture_speed'] {
  return observations.find((o) => o.lecture_speed)?.lecture_speed ?? 'normal'
}

function moodSummary(observations: StructuredObservation[]): string {
  const latest = observations.find((o) => o.mood)?.mood
  if (latest === 'confused') return '일부 구간에서 혼란이 감지된다.'
  if (latest === 'stalled') return '진행이 정체된 대상이 있다.'
  if (latest === 'tired') return '피로 신호가 있어 쉬는 타이밍을 검토한다.'
  if (latest === 'engaged') return '참여와 집중도가 양호하다.'
  if (latest === 'good') return '전반 분위기는 안정적이다.'
  return '아직 뚜렷한 분위기 신호가 없다.'
}

export function buildSituationSnapshot(input: {
  sessionId: string
  currentPhase?: string
  observations: StructuredObservation[]
  materials?: MaterialVersion[]
  generatedAt: string
}): SituationSnapshot {
  // 해결완료(resolved) 항목은 현재 상황 집계(위험도·블로커·질문·미해결 대상)에서 제외한다.
  const observations = [...input.observations].filter((o) => !o.resolved).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const questionCount = observations.filter((o) => o.category === 'question').length
  const blockers = observations.filter((o) => o.category === 'error' || o.severity === 'high' || o.severity === 'urgent')
  const urgent = observations.filter((o) => o.severity === 'urgent').length
  const unresolvedTargets = [...new Set(blockers.map((o) => o.target).filter(Boolean) as string[])].slice(0, 5)
  const question_load = loadLevel(questionCount)
  const lecture_speed = latestSpeed(observations)
  const shared = (input.materials ?? []).filter((m) => m.status === 'shared').length
  const review = (input.materials ?? []).filter((m) => m.status === 'review' || m.status === 'draft').length
  const mainActions = buildMainActions({ lecture_speed, question_load, blockers })
  const assistantActions = buildAssistantActions({ blockers, unresolvedTargets, review })
  const blockerSummary = blockers.length ? `${blockers.length}개 막힘/오류 신호가 있다.` : '현재 큰 막힘 신호는 없다.'
  const materialSummary = `공유 자료 ${shared}개, 검토/초안 자료 ${review}개.`
  const risk_level = riskLevel({ urgent, blockers: blockers.length, questionLoad: question_load })
  return {
    session_id: input.sessionId,
    generated_at: input.generatedAt,
    current_phase: input.currentPhase ?? '현재 단계 미지정',
    risk_level,
    mood_summary: moodSummary(observations),
    lecture_speed,
    question_load,
    blocker_summary: blockerSummary,
    material_summary: materialSummary,
    ai_summary: buildAiSummary({ risk_level, blockerSummary, question_load, lecture_speed }),
    suggested_main_instructor_actions: mainActions,
    suggested_assistant_actions: assistantActions,
    unresolved_targets: unresolvedTargets
  }
}

function buildAiSummary(input: {
  risk_level: SituationSnapshot['risk_level']
  blockerSummary: string
  question_load: SituationSnapshot['question_load']
  lecture_speed: SituationSnapshot['lecture_speed']
}): string {
  const risk = input.risk_level === 'red' ? '주의가 필요하다' : input.risk_level === 'yellow' ? '약한 정체가 있다' : '안정적이다'
  const speed = input.lecture_speed === 'fast' ? '강의 속도는 빠른 편이다' : input.lecture_speed === 'slow' ? '강의 속도는 느린 편이다' : '강의 속도는 보통이다'
  const questions = input.question_load === 'high' ? '질문이 많이 쌓이고 있다' : input.question_load === 'medium' ? '질문이 일부 쌓이고 있다' : '질문 부담은 낮다'
  return `${risk}. ${speed}. ${questions}. ${input.blockerSummary}`
}

function buildMainActions(input: {
  lecture_speed: SituationSnapshot['lecture_speed']
  question_load: SituationSnapshot['question_load']
  blockers: StructuredObservation[]
}): string[] {
  const actions: string[] = []
  if (input.lecture_speed === 'fast') actions.push('실습 설명 속도를 2~3분 늦추고 핵심 단계를 다시 보여준다.')
  if (input.question_load !== 'low') actions.push('반복 질문을 묶어 전체 공통 답변 시간을 만든다.')
  if (input.blockers.some((b) => /로그인|접속|시크릿/i.test(`${b.issue ?? ''} ${b.solution ?? ''}`))) actions.push('로그인/접속 우회법을 전체 공지한다.')
  if (!actions.length) actions.push('현재 흐름을 유지하되 다음 실습 전 확인 질문을 받는다.')
  return actions.slice(0, 4)
}

function buildAssistantActions(input: { blockers: StructuredObservation[]; unresolvedTargets: string[]; review: number }): string[] {
  const actions = input.unresolvedTargets.map((target) => `${target} 지원 상태를 먼저 확인한다.`)
  if (input.blockers.length > input.unresolvedTargets.length) actions.push('대상 미지정 오류 로그를 확인해 담당자를 배정한다.')
  if (input.review > 0) actions.push('검토/초안 상태 자료의 공유 가능 여부를 확인한다.')
  if (!actions.length) actions.push('질문과 실습 막힘이 새로 생기는지 대시보드를 유지 관찰한다.')
  return actions.slice(0, 5)
}
