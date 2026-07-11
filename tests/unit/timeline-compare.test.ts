import { describe, it, expect } from 'vitest'
import { evaluateProgress, ms, type PlannedChapter, type ProgressObs } from '@/lib/liveops/timeline-compare'

const CH: PlannedChapter[] = [
  { id: 'ch01', title: 'AI 핵심 개념 & 시연', start: '09:30', end: '10:20' },
  { id: 'ch02', title: 'Gemini · Gems', start: '10:30', end: '12:00' },
  { id: 'ch03', title: 'NotebookLM', start: '13:00', end: '14:00' },
  { id: 'ch04', title: '에이전틱 도구 — 소개·설치', start: '14:00', end: '14:30' },
  { id: 'ch05', title: '공통 실습 4종', start: '14:30', end: '16:30' },
  { id: 'ch06', title: '자율 심화', start: '16:30', end: '16:50' }
]
const DATE = '2026-07-07'
const at = (hhmm: string) => ms(DATE, hhmm)
const obs = (summary: string, t = '15:00'): ProgressObs => ({ summary, created_at: `${DATE}T${t}:00+09:00` })

describe('evaluateProgress', () => {
  it('정시: 관찰이 계획상 현재 챕터를 가리키면 (정시)', () => {
    const r = evaluateProgress(CH, DATE, at('15:00'), [obs('공통 실습 배포 진행 중')])
    expect(r.expectedIdx).toBe(4) // ch05 14:30~16:30
    expect(r.actualIdx).toBe(4)
    expect(r.label).toContain('정시')
    expect(r.tone).toBe('accent')
  })

  it('★재발방지: 뒤 챕터 실습에서 앞 챕터 도구(Gemini) 재언급해도 앞 챕터로 후퇴하지 않는다', () => {
    // 대부분 ch05, 한 건만 Gemini(ch02) 언급 → max 로 ch05 유지, "몇 시간 지연" 안 뜸
    const r = evaluateProgress(CH, DATE, at('16:14'), [obs('공통 실습 중'), obs('제미나이로 이미지 만드는 실습')])
    expect(r.actualIdx).toBe(4) // ch05 (ch02로 후퇴 X)
    expect(r.label).not.toMatch(/시간/) // 시간 단위 지연 표기 없음
    expect(r.tone).not.toBe('warn')
  })

  it('★재발방지: 실제진행이 잘못 앞 챕터로 잡혀도 지연 수치는 90분 상한 넘기지 않는다', () => {
    // 관찰이 ch02(Gemini)만 → actual=ch02, now=16:14 → 원래라면 4시간+ 지연으로 계산되던 케이스
    const r = evaluateProgress(CH, DATE, at('16:14'), [obs('제미나이 젬스 실습')])
    expect(r.actualIdx).toBe(1) // ch02
    expect(r.expectedIdx).toBe(4) // ch05
    expect(r.label).not.toMatch(/시간/) // 4시간 지연 같은 표기 금지
    expect(r.label).not.toMatch(/약 \d/) // 상한 초과라 수치 자체를 안 보여줌
    expect(r.label).toContain('추정')
  })

  it('작은 지연(≤90분)은 수치로 표기', () => {
    // actual=ch05(끝 16:30), now=17:30 → 60분 지연
    const r = evaluateProgress(CH, DATE, at('17:30'), [obs('공통 실습 마무리 중')])
    expect(r.actualIdx).toBe(4)
    expect(r.label).toMatch(/약 .*분/)
    expect(r.label).toContain('추정')
  })

  it('최근 25건만 반영: 오래된 뒤-챕터 언급은 실제진행을 끌어올리지 않는다', () => {
    const many: ProgressObs[] = []
    for (let i = 0; i < 25; i++) many.push(obs('노트북 실습 진행', `13:${String(i).padStart(2, '0')}`)) // 최근 25 = ch03
    many.push(obs('자율 심화 예고', '09:00')) // 오래된 ch06 언급
    const r = evaluateProgress(CH, DATE, at('13:30'), many)
    expect(r.actualIdx).toBe(2) // ch03 (ch06으로 안 튐)
  })

  it('빠름: 실제진행이 계획상 현재보다 앞서면 (빠름)', () => {
    const r = evaluateProgress(CH, DATE, at('13:30'), [obs('공통 실습 4종 시작')])
    expect(r.expectedIdx).toBe(2) // ch03 13:00~14:00
    expect(r.actualIdx).toBe(4) // ch05
    expect(r.label).toContain('빠름')
    expect(r.tone).toBe('accent')
  })

  it('관찰 없으면 대기', () => {
    const r = evaluateProgress(CH, DATE, at('15:00'), [])
    expect(r.actualIdx).toBe(-1)
    expect(r.label).toContain('대기')
  })
})
