import type { DialogueStateMap } from './stateMap'

export type DialogueNudgeKind =
  | 'answer_question'
  | 'ask_evidence'
  | 'define_term'
  | 'separate_axis'
  | 'draft_common_ground'

export type DialogueNudgeVisibility = 'operator_only' | 'projector_safe' | 'participant_safe'

export type DialogueNudge = {
  id: string
  kind: DialogueNudgeKind
  label: string
  prompt: string
  sourceSegmentIds: string[]
  visibility: DialogueNudgeVisibility
  priority: 'low' | 'medium'
}

export type DialogueNudgeSet = {
  all: DialogueNudge[]
  operator: DialogueNudge[]
  projector: DialogueNudge[]
  participant: DialogueNudge[]
}

export function buildDialogueNudges(mirror: DialogueStateMap): DialogueNudgeSet {
  const all: DialogueNudge[] = [
    ...mirror.openQuestions
      .filter((q) => q.status === 'open')
      .slice(0, 3)
      .map((q): DialogueNudge => ({
        id: `nudge:${q.id}`,
        kind: 'answer_question',
        label: '열린 질문',
        prompt: '이 질문에 답할 차례를 만들어 보세요.',
        sourceSegmentIds: [q.segmentId],
        visibility: 'projector_safe',
        priority: 'medium'
      })),
    ...mirror.evidenceConnections
      .filter((e) => e.posture === 'waiting')
      .slice(0, 3)
      .map((e): DialogueNudge => ({
        id: `nudge:evidence:${e.segmentId}`,
        kind: 'ask_evidence',
        label: '근거 이어보기',
        prompt: '이 주장에 연결된 경험, 자료, 사례를 이어서 물어볼 수 있습니다.',
        sourceSegmentIds: [e.segmentId],
        visibility: 'participant_safe',
        priority: 'medium'
      })),
    ...mirror.conceptThreads
      .filter((c) => c.posture === 'needs_definition')
      .slice(0, 3)
      .map((c): DialogueNudge => ({
        id: `nudge:concept:${c.term}`,
        kind: 'define_term',
        label: '정의 확인',
        prompt: `"${c.term}"의 의미를 한 문장으로 맞춰 보세요.`,
        sourceSegmentIds: c.segmentIds,
        visibility: 'projector_safe',
        priority: 'medium'
      })),
    ...mirror.tensionAxes.slice(0, 2).map((a): DialogueNudge => ({
      id: `nudge:axis:${a.id}`,
      kind: 'separate_axis',
      label: '갈림 축',
      prompt: `${a.left}과 ${a.right}을 같은 선택지로 묶지 말고, 각각의 판단 기준을 분리해 보세요.`,
      sourceSegmentIds: a.segmentIds,
      visibility: 'projector_safe',
      priority: 'medium'
    })),
    ...mirror.commonGround.slice(0, 2).map((g): DialogueNudge => ({
      id: `nudge:ground:${g.id}`,
      kind: 'draft_common_ground',
      label: '합의 후보',
      prompt: `"${g.label}" 주변의 공통 표현을 합의 문장으로 바꿀 수 있는지 확인해 보세요.`,
      sourceSegmentIds: g.segmentIds,
      visibility: 'participant_safe',
      priority: 'low'
    }))
  ]

  const operator = all
  const projector = all.filter((n) => n.visibility === 'projector_safe')
  const participant = all.filter((n) => n.visibility === 'participant_safe' || n.visibility === 'projector_safe')

  return { all, operator, projector, participant }
}

export function assertPublicNudgeCopy(copy: string): boolean {
  return !/(논리 오류|틀린 주장|근거 없음|비합리적|AI 판정|위험 발언|오류 점수|점수|순위|경고)/.test(copy)
}
