import { describe, expect, it } from 'vitest'
import { buildDialogueNudges, assertPublicNudgeCopy } from '@/lib/dialogue/nudges'
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

describe('dialogue nudges', () => {
  it('대화 상태에서 참가자와 프로젝터에 공개 가능한 다음 행동을 만든다', () => {
    const mirror = buildDialogueStateMap([
      seg('s1', '참여 방식은 어떻게 정하나요?', 0, 'g1'),
      seg('s2', '예산 부담이 우려됩니다.', 10_000, 'g2'),
      seg('s3', '야간 시간 접근이 필요합니다.', 20_000, 'g3'),
      seg('s4', '공정한 운영 기준이 필요합니다.', 30_000, 'g1'),
      seg('s5', '공정한 예산 부담도 같이 봐야 합니다.', 40_000, 'g2')
    ])

    const nudges = buildDialogueNudges(mirror)

    expect(nudges.operator.length).toBeGreaterThan(0)
    expect(nudges.projector.map((n) => n.kind)).toContain('answer_question')
    expect(nudges.participant.map((n) => n.kind)).toContain('ask_evidence')
    for (const nudge of nudges.participant) {
      expect(assertPublicNudgeCopy(`${nudge.label} ${nudge.prompt}`)).toBe(true)
    }
    expect(JSON.stringify(nudges)).not.toMatch(/논리 오류|틀린 주장|근거 없음|비합리적|AI 판정|위험 발언|오류 점수|점수|순위|경고/)
  })
})
