// 기획 타임라인 vs 실제 진행 비교의 순수 로직 — 컴포넌트에서 분리해 테스트로 잠근다.
// 오판 재발 방지: (1) 실제진행은 최근 관찰 max(앞 챕터로 후퇴 금지) (2) 지연 수치 90분 상한.

export type PlannedChapter = { id: string; title: string; start: string; end: string }
export type ProgressObs = { summary?: string | null; issue?: string | null; question?: string | null; answer?: string | null; created_at?: string }

// AI 도구명 EN↔KO 별칭(도메인 공용). 여러 챕터에 걸치는 일반어는 STOP 제외.
const STOP = new Set(['및', '종', '도구', '실습', '소개', '자료', '참고', '오늘', '여정', '핵심', 'ai', 'the', 'and'])
const ALIASES: Record<string, string[]> = {
  gemini: ['gemini', '제미나이'], gems: ['gems', '젬'], notebooklm: ['notebooklm', '노트북', 'notebook lm'],
  claude: ['claude', '클로드'], chatgpt: ['chatgpt', '챗지피티'], antigravity: ['antigravity', '안티그래비티'],
  agentic: ['agentic', '에이전틱', '에이전트'], copilot: ['copilot', '코파일럿'], midjourney: ['midjourney', '미드저니']
}

export function deriveKeywords(title: string): string[] {
  const toks = title.toLowerCase().split(/[\s·—\-&,()/]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d/.test(w))
  const out = new Set<string>()
  for (const t of toks) (ALIASES[t] ?? [t]).forEach((k) => out.add(k))
  return [...out]
}

export function chapterOf(text: string, kwsByChapter: string[][]): number {
  const t = text.toLowerCase()
  let hit = -1
  kwsByChapter.forEach((kws, idx) => { if (kws.some((k) => t.includes(k))) hit = idx })
  return hit
}

export function ms(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm}:00+09:00`).getTime()
}
export function fmtDelta(min: number): string {
  const h = Math.floor(min / 60), m = min % 60
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`
}

export type ProgressResult = {
  chs: (PlannedChapter & { startMs: number; endMs: number; kws: string[] })[]
  expectedIdx: number
  inGap: boolean
  actualIdx: number
  tone: 'accent' | 'warn' | 'neutral'
  label: string
}

const RECENT_WINDOW = 25
const BEHIND_CAP_MIN = 90 // 이보다 큰 '지연'은 추정 오류로 보고 수치 대신 문구만

export function evaluateProgress(chapters: PlannedChapter[], sessionDate: string, nowMs: number | null, observations: ProgressObs[]): ProgressResult {
  const chs = chapters.map((c) => ({ ...c, startMs: ms(sessionDate, c.start), endMs: ms(sessionDate, c.end), kws: deriveKeywords(c.title) }))
  const kwsByChapter = chs.map((c) => c.kws)

  // 계획상 현재(시계 기준)
  let expectedIdx = chs.findIndex((c) => nowMs !== null && nowMs >= c.startMs && nowMs < c.endMs)
  let inGap = false
  if (expectedIdx < 0 && nowMs !== null && chs.length) {
    if (nowMs < chs[0].startMs) expectedIdx = 0
    else if (nowMs >= chs[chs.length - 1].endMs) expectedIdx = chs.length - 1
    else { expectedIdx = chs.findIndex((c) => c.startMs > nowMs); inGap = true }
  }

  // 실제 진행(추정) = 최근 관찰 중 언급된 가장 앞선 챕터(max → 후퇴 금지, 최근만 → 오래된 언급 배제)
  const recent = [...observations].sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''))).slice(0, RECENT_WINDOW)
  let actualIdx = -1
  for (const o of recent) {
    const idx = chapterOf([o.summary, o.issue, o.question, o.answer].filter(Boolean).join(' '), kwsByChapter)
    if (idx > actualIdx) actualIdx = idx
  }

  let tone: ProgressResult['tone'] = 'neutral'
  let label = '관찰 대기'
  if (actualIdx >= 0 && expectedIdx >= 0 && nowMs !== null) {
    if (actualIdx === expectedIdx) { tone = 'accent'; label = '계획대로 (정시)' }
    else if (actualIdx > expectedIdx) { tone = 'accent'; label = '계획보다 빠름 (추정)' }
    else {
      const behindMin = Math.max(0, Math.round((nowMs - chs[actualIdx].endMs) / 60000))
      tone = 'warn'
      label = behindMin > 0 && behindMin <= BEHIND_CAP_MIN ? `계획보다 뒤 · 약 ${fmtDelta(behindMin)} (추정)` : '계획보다 뒤 (추정)'
    }
  }
  return { chs, expectedIdx, inGap, actualIdx, tone, label }
}
