import { describe, expect, it } from 'vitest'
import { parseRawNote } from '@/lib/liveops/parser'

describe('liveops parser', () => {
  it('로그인 막힘과 해결책, 속도 신호를 구조화한다', () => {
    const r = parseRawNote({
      id: 'ob-test',
      sessionId: 'se-001-DEMO',
      rawText: '13:20 2번 테이블 클로드 로그인 막힘. 시크릿 모드 하니까 해결됨. 속도 좀 빠름',
      createdAt: '2026-06-01T00:00:00.000Z'
    })
    expect(r.category).toBe('error')
    expect(r.time_label).toBe('13:20')
    expect(r.target).toBe('2번 테이블')
    expect(r.lecture_speed).toBe('fast')
    expect(r.severity).toBe('high')
    expect(r.solution).toContain('시크릿')
  })

  it('질문 입력을 question category로 분류한다', () => {
    const r = parseRawNote({ id: 'ob-q', sessionId: 'se-001-DEMO', rawText: '참가자 질문 많음. MCP랑 Claude Code 차이가 궁금' })
    expect(r.category).toBe('question')
    expect(r.question).toContain('질문')
  })
})
