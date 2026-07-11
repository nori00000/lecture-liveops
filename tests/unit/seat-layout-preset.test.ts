import { describe, it, expect } from 'vitest'
import { buildLectureT8SeatLayout, LECTURE_T8_ROW_YS } from '@/lib/seatmap/layout'

describe('buildLectureT8SeatLayout — Lecture LiveOps 8팀 6석 3/3/2 레이아웃', () => {
  it('정확히 8팀 48석의 T자 테이블을 생성해야 함', () => {
    const layout = buildLectureT8SeatLayout()
    expect(layout.tables).toHaveLength(8)

    // 각 팀당 6석 검증
    layout.tables.forEach((t, i) => {
      expect(t.seats).toHaveLength(6)
      expect(t.kind).toBe('tshape')
      expect(t.label).toBe(`${i + 1}팀`)
    })

    const totalSeats = layout.tables.reduce((sum, t) => sum + t.seats.length, 0)
    expect(totalSeats).toBe(48)
  })

  it('3행(3/3/2) 배치에 따라 Y축 좌표가 LECTURE_T8_ROW_YS(26, 54, 82)를 준수해야 함', () => {
    const layout = buildLectureT8SeatLayout()

    // 행별 인덱스:
    // 0~2 (1,2,3팀) -> 1행 (Y: 26)
    // 3~5 (4,5,6팀) -> 2행 (Y: 54)
    // 6~7 (7,8팀)   -> 3행 (Y: 82)
    layout.tables.forEach((t, idx) => {
      const row = Math.floor(idx / 3)
      const expectedY = LECTURE_T8_ROW_YS[row]
      expect(t.cy).toBe(expectedY)
    })
  })

  it('각 행 안의 테이블이 균등 가로(X) 정렬을 갖는지 검증', () => {
    const layout = buildLectureT8SeatLayout()

    // 1행 (3팀): x = 25%, 50%, 75%
    expect(layout.tables[0].cx).toBeCloseTo(25)
    expect(layout.tables[1].cx).toBeCloseTo(50)
    expect(layout.tables[2].cx).toBeCloseTo(75)

    // 2행 (3팀): x = 25%, 50%, 75%
    expect(layout.tables[3].cx).toBeCloseTo(25)
    expect(layout.tables[4].cx).toBeCloseTo(50)
    expect(layout.tables[5].cx).toBeCloseTo(75)

    // 3행 (2팀): x = 33.3%, 66.7% (가운데로 몰아서 정렬)
    expect(layout.tables[6].cx).toBeCloseTo(33.33, 1)
    expect(layout.tables[7].cx).toBeCloseTo(66.66, 1)
  })
})
