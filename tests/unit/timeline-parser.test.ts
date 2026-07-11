import { describe, expect, it } from 'vitest'
import {
  looksLikeStaticSlideDeck,
  parseStaticSlidesHtml
} from '@/lib/liveops/timeline-parser'

const mockStaticDeckHtml = `
<!DOCTYPE html>
<html>
<head>
  <script type="application/json" id="speaker-notes">["노트1", "노트2", "노트3"]</script>
</head>
<body>
  <deck-stage width="1920" height="1080">
    <section data-label="01 Title" class="slide paper">
      <h1>내 일을 바꾸는 바이브 코딩</h1>
      <div class="time">09:00–16:30</div>
    </section>
    <section data-label="04 Roadmap" class="slide cream-deep">
      <div class="kicker">이틀의 여정</div>
      <div class="time">2 Days</div>
    </section>
    <section data-label="07 CH.1 Cover" class="slide cream-deep">
      <div class="chap-label">CHAPTER 1 · DAY 1 오전</div>
      <h1>AI, 어디까지 왔나</h1>
    </section>
    <section data-label="08 Intro" class="slide paper">
      <div class="head">
        <div class="section-tag">AI Agent</div>
        <div class="time">09:15</div>
      </div>
      <p>에이전트 기초 개념 설명</p>
    </section>
    <section data-label="14 Ch.2 Cover" class="slide cream-deep">
      <div class="chap-label">CHAPTER 2 · DAY 1 오후</div>
      <h1>명세(PRD) 만들기</h1>
    </section>
    <section data-label="15 Practice" class="slide paper">
      <div class="head">
        <div class="time">13:30</div>
      </div>
      <p>실습 진행</p>
    </section>
    <section data-label="38 Peer Review" class="slide paper">
      <div class="head"><div class="time">08:30</div></div>
      <div class="kicker">상호 피드백</div>
    </section>
  </deck-stage>
</body>
</html>
`

describe('timeline static slide deck parser', () => {
  it('detects static slide deck markers', () => {
    expect(looksLikeStaticSlideDeck(mockStaticDeckHtml)).toBe(true)
    expect(looksLikeStaticSlideDeck('<html><body>hello</body></html>')).toBe(false)
  })

  it('parses static slides and maps to chapters/milestones', () => {
    const chapters = parseStaticSlidesHtml(mockStaticDeckHtml)
    expect(chapters.length).toBeGreaterThanOrEqual(3)

    // Chapter 1 (07 CH.1 Cover) -> time inferred from slide 08 Intro (09:15)
    const ch1 = chapters.find(c => c.title.includes('AI, 어디까지 왔나'))
    expect(ch1).toBeDefined()
    expect(ch1?.start).toBe('09:15')

    // Chapter 2 (14 Ch.2 Cover) -> time inferred from slide 15 Practice (13:30)
    const ch2 = chapters.find(c => c.title.includes('명세(PRD) 만들기'))
    expect(ch2).toBeDefined()
    expect(ch2?.start).toBe('13:30')

    // Milestone Peer Review (38 Peer Review) -> has explicit time (08:30)
    const ch3 = chapters.find(c => c.title.includes('Peer Review') || c.title.includes('상호 피드백'))
    expect(ch3).toBeDefined()
    expect(ch3?.start).toBe('08:30')
  })

  it('returns empty array when no slides or timeline match', () => {
    expect(parseStaticSlidesHtml('<html><body>no sections</body></html>')).toEqual([])
  })
})
