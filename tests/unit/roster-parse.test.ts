import { describe, it, expect } from 'vitest'
import { parseRosterPaste, splitNames, splitMembersLoose, normalizeLabel } from '@/lib/seatmap/roster-parse'

describe('roster-parse', () => {
  it('깨끗한 형식: 팀 헤더 + 이름 줄', () => {
    const teams = parseRosterPaste(['A-1팀', '이정현 김영환 김영우 이승민', 'A-2팀', '김병각 김현종'].join('\n'))
    expect(teams).toHaveLength(2)
    expect(teams[0].label).toBe('A-1팀')
    expect(teams[0].members).toEqual(['이정현', '김영환', '김영우', '이승민'])
    expect(teams[1].members).toEqual(['김병각', '김현종'])
  })

  it('PDF 페이지 통짜 붙여넣기: 반 헤더·범례·강사·N명을 걸러낸다', () => {
    const blob = [
      'A반 · 입문 (Claude Code Enterprise) 주강사 곽은철 · 보조강사 김승우 · 총 31명 · 6명×5팀',
      '스크린',
      '강사석',
      'A-1팀 7명',
      '이정현 김영환 김영우 이승민',
      '박명수 임대현 김진환',
      'A-2팀 6명',
      '김병각 김현종 김주영 박상민',
      '김영일 성주경',
      '↑ 스크린·강사석 방향 · 한 팀 = 세로 책상 2개 + 가로 책상 1개'
    ].join('\n')
    const teams = parseRosterPaste(blob)
    expect(teams).toHaveLength(2)
    expect(teams[0].label).toBe('A-1팀')
    expect(teams[0].members).toHaveLength(7)
    expect(teams[1].members).toEqual(['김병각', '김현종', '김주영', '박상민', '김영일', '성주경'])
    // 강사(곽은철/김승우)·범례어(스크린/강사석/방향/책상)는 명단에 섞이지 않는다
    const all = teams.flatMap((t) => t.members)
    expect(all).not.toContain('곽은철')
    expect(all).not.toContain('김승우')
    expect(all).not.toContain('스크린')
    expect(all).not.toContain('강사석')
  })

  it('헤더가 없으면 자동 팀 1개로 모은다', () => {
    const teams = parseRosterPaste('홍길동 김철수\n이영희')
    expect(teams).toHaveLength(1)
    expect(teams[0].label).toBe('1팀')
    expect(teams[0].members).toEqual(['홍길동', '김철수', '이영희'])
  })

  it('normalizeLabel: "N명"과 공백 제거', () => {
    expect(normalizeLabel('A-1팀 7명')).toBe('A-1팀')
    expect(normalizeLabel('3 팀')).toBe('3팀')
  })

  it('splitNames는 한글 이름만, splitMembersLoose는 그대로', () => {
    expect(splitNames('이정현 7명 김영환')).toEqual(['이정현', '김영환'])
    expect(splitMembersLoose('Alex, 김영환\n이승민')).toEqual(['Alex', '김영환', '이승민'])
  })
})
