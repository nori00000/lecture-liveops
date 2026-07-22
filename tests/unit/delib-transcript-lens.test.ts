import { describe, expect, it } from 'vitest'
import { buildTranscriptLensSummary, type TranscriptLensSegmentInput } from '@/lib/delib/transcriptLens'

const groups = [
  { id: 'g1', label: '1조' },
  { id: 'g2', label: '2조' }
]

function seg(input: Partial<TranscriptLensSegmentInput> & { id: string; text: string; groupId: string | null }): TranscriptLensSegmentInput {
  return {
    sourceId: 'src',
    roundId: 'r1',
    speakerTag: 'speaker',
    startedMs: 0,
    endedMs: 1000,
    confidence: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input
  }
}

describe('delib transcript lens', () => {
  it('키워드 빈도와 weight 를 계산한다', () => {
    const out = buildTranscriptLensSummary([
      seg({ id: 'a', groupId: 'g1', text: '예산 리스크가 큽니다. 예산 근거가 필요합니다.' }),
      seg({ id: 'b', groupId: 'g2', text: '예산 배분 기준에 동의합니다.' })
    ], groups)

    expect(out.keywords[0]).toMatchObject({ term: '예산', count: 3, weight: 1 })
    expect(out.keywords.map((k) => k.term)).toContain('리스크가')
  })

  it('질문·동의·반대·우려 신호를 센다', () => {
    const out = buildTranscriptLensSummary([
      seg({ id: 'q', groupId: 'g1', text: '왜 이 방식이 필요한가요?' }),
      seg({ id: 'a', groupId: 'g1', text: '저는 이 기준에 동의합니다.' }),
      seg({ id: 'd', groupId: 'g2', text: '그 방식에는 반대합니다.' }),
      seg({ id: 'c', groupId: 'g2', text: '예산 부담과 리스크가 우려됩니다.' })
    ], groups)

    expect(out.pulse).toEqual({ questions: 1, agreements: 1, disagreements: 1, concerns: 1 })
  })

  it('그룹별 발화량 share 를 텍스트 길이 기준으로 계산한다', () => {
    const out = buildTranscriptLensSummary([
      seg({ id: 'a', groupId: 'g1', text: 'aaaa' }),
      seg({ id: 'b', groupId: 'g2', text: 'bbbbbbbbbbbb' })
    ], groups)

    expect(out.groupActivity.find((g) => g.groupId === 'g1')).toMatchObject({ segmentCount: 1, textLength: 4, share: 0.25 })
    expect(out.groupActivity.find((g) => g.groupId === 'g2')).toMatchObject({ segmentCount: 1, textLength: 12, share: 0.75 })
  })

  it('빈 입력에서도 모든 그룹을 유지한다', () => {
    const out = buildTranscriptLensSummary([], groups)

    expect(out.keywords).toEqual([])
    expect(out.pulse).toEqual({ questions: 0, agreements: 0, disagreements: 0, concerns: 0 })
    expect(out.groupActivity).toHaveLength(2)
    expect(out.groupActivity.every((g) => g.segmentCount === 0 && g.textLength === 0)).toBe(true)
  })
})
