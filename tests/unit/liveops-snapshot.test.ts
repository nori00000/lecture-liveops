import { describe, expect, it } from 'vitest'
import { parseRawNote } from '@/lib/liveops/parser'
import { buildSituationSnapshot } from '@/lib/liveops/snapshot'

describe('liveops snapshot', () => {
  it('관찰 로그를 메인/보조강사용 액션으로 요약한다', () => {
    const observations = [
      parseRawNote({ id: 'ob-1', sessionId: 'se-001-DEMO', rawText: '2번 테이블 로그인 막힘. 시크릿 모드로 해결' }),
      parseRawNote({ id: 'ob-2', sessionId: 'se-001-DEMO', rawText: '질문 많음. VS Code extension 연결 헷갈려함' }),
      parseRawNote({ id: 'ob-3', sessionId: 'se-001-DEMO', rawText: '속도 빠름. 실습 설명 더 필요' })
    ]
    const s = buildSituationSnapshot({ sessionId: 'se-001-DEMO', currentPhase: 'Claude Code 실습', observations, materials: [], generatedAt: '2026-06-01T00:00:00.000Z' })
    expect(s.current_phase).toBe('Claude Code 실습')
    expect(s.risk_level).not.toBe('green')
    expect(s.lecture_speed).toBe('fast')
    expect(s.suggested_main_instructor_actions.join(' ')).toContain('속도')
    expect(s.suggested_assistant_actions.length).toBeGreaterThan(0)
  })
})
