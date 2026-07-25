import { describe, expect, it } from 'vitest'
import { buildDialogueStateMap, type DialogueMirrorSegment } from '@/lib/dialogue/stateMap'

function seg(id: string, text: string, startedMs: number, groupId: string | null = 'g1'): DialogueMirrorSegment {
  return {
    id,
    groupId,
    speakerTag: groupId ?? '전체',
    startedMs,
    text,
    createdAt: `2026-01-01T00:00:${String(startedMs / 1000).padStart(2, '0')}.000Z`
  }
}

describe('dialogue state map', () => {
  it('답변되지 않은 질문을 열린 질문으로 표시한다', () => {
    const out = buildDialogueStateMap([
      seg('s1', '야간 연장이 왜 필요한가요?', 0),
      seg('s2', '예산 부담이 우려됩니다.', 10_000)
    ])

    expect(out.openQuestions[0]).toMatchObject({
      segmentId: 's1',
      status: 'open',
      prompt: '이 질문에 답할 차례를 만들어 보세요.'
    })
  })

  it('질문 이후 관련 답변이 있으면 다뤄짐으로 표시한다', () => {
    const out = buildDialogueStateMap([
      seg('s1', '야간 연장이 왜 필요한가요?', 0),
      seg('s2', '야간 이용자가 많기 때문에 필요합니다.', 10_000)
    ])

    expect(out.openQuestions[0]).toMatchObject({ segmentId: 's1', status: 'touched' })
    expect(out.openQuestions[0].relatedSegmentIds).toContain('s2')
  })

  it('같은 개념이 여러 그룹과 맥락에서 반복되면 정의 확인 후보로 둔다', () => {
    const out = buildDialogueStateMap([
      seg('s1', '공정한 운영 기준이 필요합니다.', 0, 'g1'),
      seg('s2', '공정한 예산 부담도 같이 봐야 합니다.', 10_000, 'g2')
    ])

    const thread = out.conceptThreads.find((t) => t.term === '공정')
    expect(thread?.posture).toBe('needs_definition')
    expect(thread?.prompt).toContain('의미')
  })

  it('주장 표현을 점수화하지 않고 근거 연결 상태로만 표시한다', () => {
    const out = buildDialogueStateMap([
      seg('s1', '평일 야간 연장을 채택해야 합니다.', 0),
      seg('s2', '조사 자료 때문에 야간 수요가 확인됐습니다.', 10_000)
    ])

    expect(out.evidenceConnections.find((e) => e.segmentId === 's1')).toMatchObject({ posture: 'waiting' })
    expect(out.evidenceConnections.find((e) => e.segmentId === 's2')).toMatchObject({ posture: 'connected' })
    expect(JSON.stringify(out)).not.toMatch(/score|error|wrong|틀림|오류/)
  })

  it('갈림 축과 합의 후보를 대화 상태로 만든다', () => {
    const out = buildDialogueStateMap([
      seg('s1', '예산 부담이 우려됩니다.', 0, 'g1'),
      seg('s2', '야간 시간 접근이 필요합니다.', 10_000, 'g2'),
      seg('s3', '야간 접근 필요에는 동의합니다.', 20_000, 'g3'),
      seg('s4', '야간 접근이 함께 중요한 기준입니다.', 30_000, 'g4')
    ])

    expect(out.tensionAxes.map((a) => a.id)).toContain('budget-access')
    expect(out.commonGround.length).toBeGreaterThan(0)
    expect(out.hygiene.participantFacingCopy).toContain('평가하지 않고')
  })
})
