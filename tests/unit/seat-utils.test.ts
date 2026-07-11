import { describe, it, expect } from 'vitest'
import { tableNumberFromLabel, countProblemSeatsForTable } from '@/components/seatmap/seat-utils'
import type { SeatMark } from '@/components/seatmap/types'

const mk = (seat_key: string, status: SeatMark['status']): SeatMark => ({
  seat_key,
  status,
  reason: null,
  memo: null,
  updated_by: null,
  updated_at: null
})

describe('tableNumberFromLabel — 조/팀 라벨', () => {
  it('조·팀·A-N팀 모두 테이블 번호 추출', () => {
    expect(tableNumberFromLabel('3조')).toBe(3)
    expect(tableNumberFromLabel('3팀')).toBe(3)
    expect(tableNumberFromLabel('A-3팀')).toBe(3)
    expect(tableNumberFromLabel('A-1팀')).toBe(1)
    expect(tableNumberFromLabel('5팀')).toBe(5)
  })
  it('조/팀 없는 라벨은 null (좌석 키 오매칭 방지)', () => {
    expect(tableNumberFromLabel('table_3')).toBeNull()
    expect(tableNumberFromLabel('강사석')).toBeNull()
  })
})

describe('countProblemSeatsForTable — 팀 라벨 대응', () => {
  const marks = [mk('3-2', 'problem'), mk('3-4', 'problem'), mk('3-1', 'resolved'), mk('1-1', 'problem')]
  it('팀 라벨(A-3팀/3팀)에서도 조와 동일하게 문제 좌석 수를 센다', () => {
    expect(countProblemSeatsForTable(marks, 'A-3팀')).toBe(2)
    expect(countProblemSeatsForTable(marks, '3팀')).toBe(2)
    expect(countProblemSeatsForTable(marks, '3조')).toBe(2)
  })
  it('다른 팀은 그 팀만 카운트', () => {
    expect(countProblemSeatsForTable(marks, 'A-1팀')).toBe(1)
    expect(countProblemSeatsForTable(marks, 'A-2팀')).toBe(0)
  })
})
