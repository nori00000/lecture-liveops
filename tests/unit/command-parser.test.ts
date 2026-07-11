/**
 * 트랙 A — 자연어 좌석 명령 결정론 파서 단위 테스트.
 * 좌석 키는 실제 Generic 레이아웃(8조 x 6석 = "1-1".."8-6")에서 추출해 사용한다.
 */

import { describe, it, expect } from 'vitest'
import { parseCommand, REASON_LABEL_KO } from '@/lib/seatmap/command-parser'
import { buildEightTeamSeatLayout, buildTshapeLayout } from '@/lib/seatmap/layout'

const KEYS = buildEightTeamSeatLayout().tables.flatMap((t) => t.seats.map((s) => s.key))
// 4팀 × 4석 배치도 — 전역 좌석수 유추 검증용
const KEYS4 = buildTshapeLayout({ teams: 4, seatsPerTeam: 4 }).tables.flatMap((t) => t.seats.map((s) => s.key))

describe('parseCommand — 좌석 식별', () => {
  it('전역 번호 변환: "14 15 문제" → 3-2, 3-3 (조=ceil(n/6), 번호=((n-1)%6)+1)', () => {
    const p = parseCommand('14 15 문제', KEYS)
    expect(p).not.toBeNull()
    expect(p!.intent).toBe('problem')
    expect(p!.seatKeys).toEqual(['3-2', '3-3'])
    expect(p!.unmatched).toEqual([])
  })

  it('48 초과 전역 번호는 unmatched: "49 50 문제"', () => {
    const p = parseCommand('49 50 문제', KEYS)
    expect(p).not.toBeNull()
    expect(p!.seatKeys).toEqual([])
    expect(p!.unmatched).toEqual(['49', '50'])
  })

  it('경계값: "1 문제" → 1-1, "48 문제" → 8-6, "0 문제" → unmatched', () => {
    expect(parseCommand('1 문제', KEYS)!.seatKeys).toEqual(['1-1'])
    expect(parseCommand('48 문제', KEYS)!.seatKeys).toEqual(['8-6'])
    expect(parseCommand('0 문제', KEYS)!.unmatched).toEqual(['0'])
  })

  it('직접 키: "3-2" (인텐트 없음 → 기본 problem)', () => {
    const p = parseCommand('3-2', KEYS)
    expect(p!.intent).toBe('problem')
    expect(p!.seatKeys).toEqual(['3-2'])
  })

  it('"팀"도 "조"와 동일 취급: "2팀 4번" → 2-4 (팀 라벨 레이아웃 대응)', () => {
    expect(parseCommand('2팀 4번', KEYS)!.seatKeys).toEqual(['2-4'])
    expect(parseCommand('3팀2번', KEYS)!.seatKeys).toEqual(['3-2'])
    expect(parseCommand('2팀 4번 문제', KEYS)!.seatKeys).toEqual(['2-4'])
    // 팀 맥락 상속: "2팀 4번 5번" → 2-4, 2-5
    expect(parseCommand('2팀 4번 5번', KEYS)!.seatKeys).toEqual(['2-4', '2-5'])
    // 팀 전체
    expect(parseCommand('5팀 전체 문제', KEYS)!.seatKeys).toEqual(['5-1', '5-2', '5-3', '5-4', '5-5', '5-6'])
  })

  it('"3조 2번" / "3조2번" / "3조 2" → 3-2', () => {
    expect(parseCommand('3조 2번 해결', KEYS)!.seatKeys).toEqual(['3-2'])
    expect(parseCommand('3조2번 해결', KEYS)!.seatKeys).toEqual(['3-2'])
    expect(parseCommand('3조 2 해결', KEYS)!.seatKeys).toEqual(['3-2'])
  })

  it('범위 밖 좌석은 unmatched: "3조 9번", "9조 1번", "3-9"', () => {
    expect(parseCommand('3조 9번 문제', KEYS)!.unmatched).toEqual(['3조 9번'])
    expect(parseCommand('9조 1번 문제', KEYS)!.unmatched).toEqual(['9조 1번'])
    expect(parseCommand('3-9 문제', KEYS)!.unmatched).toEqual(['3-9'])
  })

  it('조 전체: "3조 전체 문제" / "3조 다" / "3조" → 그 조의 6석', () => {
    const all = ['3-1', '3-2', '3-3', '3-4', '3-5', '3-6']
    expect(parseCommand('3조 전체 문제 네트워크', KEYS)!.seatKeys).toEqual(all)
    expect(parseCommand('3조 다 문제', KEYS)!.seatKeys).toEqual(all)
    expect(parseCommand('3조 문제', KEYS)!.seatKeys).toEqual(all)
  })

  it('없는 조 전체는 unmatched: "9조 문제"', () => {
    expect(parseCommand('9조 문제', KEYS)!.unmatched).toEqual(['9조'])
  })

  it('쉼표/와 나열: "3-1, 3-2 해결", "14와 15 문제"', () => {
    expect(parseCommand('3-1, 3-2 해결', KEYS)!.seatKeys).toEqual(['3-1', '3-2'])
    expect(parseCommand('14와 15 문제', KEYS)!.seatKeys).toEqual(['3-2', '3-3'])
  })

  it('유효+무효 혼합: "14 49 문제" → 3-2 적용 + 49 unmatched', () => {
    const p = parseCommand('14 49 문제', KEYS)
    expect(p!.seatKeys).toEqual(['3-2'])
    expect(p!.unmatched).toEqual(['49'])
  })

  it('중복 제거: "14 14 문제" → 3-2 한 번', () => {
    expect(parseCommand('14 14 문제', KEYS)!.seatKeys).toEqual(['3-2'])
  })

  it('"14번 문제"처럼 번 접미사 전역 번호도 허용', () => {
    expect(parseCommand('14번 문제', KEYS)!.seatKeys).toEqual(['3-2'])
  })
})

describe('parseCommand — 인텐트', () => {
  it('문제/막힘/오류/에러/안됨/안돼 → problem', () => {
    for (const t of ['14 문제', '14 막힘', '14 오류', '14 에러', '14 안됨', '14 안돼요', '14 안 돼요']) {
      expect(parseCommand(t, KEYS)!.intent).toBe('problem')
    }
  })

  it('해결/완료/됐/풀림 → resolved', () => {
    for (const t of ['14 해결', '14 완료', '14 됐어요', '14 풀림']) {
      expect(parseCommand(t, KEYS)!.intent).toBe('resolved')
    }
  })

  it('초기화/리셋/취소 → clear (좌석 없으면 전체 초기화 계획)', () => {
    const p = parseCommand('마크 전부 초기화', KEYS)
    expect(p!.intent).toBe('clear')
    expect(p!.seatKeys).toEqual([])
    expect(parseCommand('리셋', KEYS)!.intent).toBe('clear')
    expect(parseCommand('14 취소', KEYS)!.seatKeys).toEqual(['3-2'])
  })

  it('좌석만 있으면 기본 problem', () => {
    expect(parseCommand('14 15', KEYS)!.intent).toBe('problem')
  })
})

describe('parseCommand — 사유 매핑과 memo', () => {
  it('설치→install, SSL/와이파이/인터넷→network, 계정/로그인→account, 진도/느려→pace, 노트북→device', () => {
    expect(parseCommand('14 문제 설치', KEYS)!.reason).toBe('install')
    expect(parseCommand('14 문제 SSL', KEYS)!.reason).toBe('network')
    expect(parseCommand('14 문제 와이파이', KEYS)!.reason).toBe('network')
    expect(parseCommand('14 문제 인터넷', KEYS)!.reason).toBe('network')
    expect(parseCommand('14 문제 계정', KEYS)!.reason).toBe('account')
    expect(parseCommand('14 문제 로그인', KEYS)!.reason).toBe('account')
    expect(parseCommand('14 문제 진도', KEYS)!.reason).toBe('pace')
    expect(parseCommand('14 느려요', KEYS)!.reason).toBe('pace')
    expect(parseCommand('14 문제 노트북', KEYS)!.reason).toBe('device')
  })

  it('짧은 조사가 붙어도 사유로 인식: "네트워크가"', () => {
    expect(parseCommand('14 문제 네트워크가', KEYS)!.reason).toBe('network')
  })

  it('memo 추출: 사유/인텐트/좌석 제외 잔여 텍스트', () => {
    const p = parseCommand('3-1 문제 설치 어댑터 꼬임', KEYS)
    expect(p!.reason).toBe('install')
    expect(p!.memo).toBe('어댑터 꼬임')
  })

  it('"14 해결 SSL이었음" — 잔여 3자 이상이면 사유가 아니라 memo로 남긴다', () => {
    const p = parseCommand('14 해결 SSL이었음', KEYS)
    expect(p!.intent).toBe('resolved')
    expect(p!.seatKeys).toEqual(['3-2'])
    expect(p!.reason).toBeUndefined()
    expect(p!.memo).toBe('SSL이었음')
  })

  it('사유/메모 없으면 필드 생략', () => {
    const p = parseCommand('14 문제', KEYS)
    expect(p!.reason).toBeUndefined()
    expect(p!.memo).toBeUndefined()
  })
})

describe('parseCommand — 해석 불가(null) → LLM fallback 대상', () => {
  it('좌석도 인텐트도 없는 문장', () => {
    expect(parseCommand('점심 맛있었어요', KEYS)).toBeNull()
  })

  it('인텐트만 있고 좌석 단서가 전혀 없는 문장 (clear 제외)', () => {
    expect(parseCommand('아까 그 자리 해결', KEYS)).toBeNull()
    expect(parseCommand('문제 생김', KEYS)).toBeNull()
  })
})

describe('REASON_LABEL_KO', () => {
  it('파서 사유 키 전부에 한국어 라벨이 있다', () => {
    for (const r of ['install', 'network', 'account', 'pace', 'device', 'etc']) {
      expect(REASON_LABEL_KO[r]).toBeTruthy()
    }
  })
})

describe('조 맥락 상속 (3조 1번 3번 버그)', () => {
  const KEYS = Array.from({ length: 8 }, (_, t) => Array.from({ length: 6 }, (_, n) => `${t + 1}-${n + 1}`)).flat()

  it("'3조 1번 3번 문제' → 3-1, 3-3 (전역 1-3 아님)", () => {
    const p = parseCommand('3조 1번 3번 문제', KEYS)
    expect(p?.seatKeys).toEqual(['3-1', '3-3'])
  })

  it("'3조 1번, 3번 문제발생' → 3-1, 3-3", () => {
    const p = parseCommand('3조 1번, 3번 문제발생', KEYS)
    expect(p?.seatKeys).toEqual(['3-1', '3-3'])
  })

  it("'3-2 4번 문제' → 3-2, 3-4 (pair 형식도 맥락 세움)", () => {
    const p = parseCommand('3-2 4번 문제', KEYS)
    expect(p?.seatKeys).toEqual(['3-2', '3-4'])
  })

  it("'3조 1번 20번 문제' → 조 범위 밖 20은 전역 (4-2)", () => {
    const p = parseCommand('3조 1번 20번 문제', KEYS)
    expect(p?.seatKeys).toEqual(['3-1', '4-2'])
  })

  it("'14 15 문제'는 회귀 없음 — 전역 유지 (3-2, 3-3)", () => {
    const p = parseCommand('14 15 문제', KEYS)
    expect(p?.seatKeys).toEqual(['3-2', '3-3'])
  })

  it("'1 2 문제'는 맥락 없이 전역 (1-1, 1-2)", () => {
    const p = parseCommand('1 2 문제', KEYS)
    expect(p?.seatKeys).toEqual(['1-1', '1-2'])
  })
})

describe('parseCommand — 폴리시(좌석수 유추·복수 사유·느려)', () => {
  it('4석 배치도에서 전역 번호는 조당 4석 기준으로 변환 ("13번"→4-1)', () => {
    // 6석 하드코딩이면 ceil(13/6)=3 → 3-1(오답). 유추가 맞으면 ceil(13/4)=4 → 4-1
    expect(parseCommand('13번 문제', KEYS4)!.seatKeys).toEqual(['4-1'])
    expect(parseCommand('5번 문제', KEYS4)!.seatKeys).toEqual(['2-1'])
  })

  it('두 번째 사유 토큰은 소실되지 않고 memo로 보존', () => {
    const p = parseCommand('14 문제 설치 네트워크', KEYS)
    expect(p!.reason).toBe('install')
    expect(p!.memo ?? '').toContain('네트워크')
  })

  it('"느려/느림"도 pace 사유로 인식', () => {
    expect(parseCommand('14 문제 느려', KEYS)!.reason).toBe('pace')
    expect(parseCommand('14 문제 느림', KEYS)!.reason).toBe('pace')
  })
})
