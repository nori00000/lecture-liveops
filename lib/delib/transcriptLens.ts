export type TranscriptLensMode = 'transcript' | 'statement_preview'

export type TranscriptLensGroupInput = {
  id: string
  label: string
}

export type TranscriptLensSegmentInput = {
  id: string
  sourceId: string
  groupId: string | null
  roundId: string | null
  speakerTag: string
  startedMs: number
  endedMs: number
  text: string
  confidence: number | null
  createdAt: string
}

export type TranscriptLensKeyword = {
  term: string
  count: number
  weight: number
}

export type TranscriptLensGroupActivity = {
  groupId: string
  label: string
  segmentCount: number
  textLength: number
  share: number
}

export type TranscriptLensPulse = {
  questions: number
  agreements: number
  disagreements: number
  concerns: number
}

export type TranscriptLensSummary = {
  keywords: TranscriptLensKeyword[]
  groupActivity: TranscriptLensGroupActivity[]
  pulse: TranscriptLensPulse
}

const STOPWORDS = new Set([
  '그리고',
  '그런데',
  '그래서',
  '하지만',
  '저는',
  '저희',
  '우리',
  '이거',
  '그거',
  '있는',
  '없는',
  '합니다',
  '같아요',
  '때문에',
  'about',
  'after',
  'again',
  'because',
  'from',
  'that',
  'this',
  'with',
  'would'
])

export function buildTranscriptLensSummary(
  segments: TranscriptLensSegmentInput[],
  groups: TranscriptLensGroupInput[],
  opts: { keywordLimit?: number } = {}
): TranscriptLensSummary {
  const keywordLimit = opts.keywordLimit ?? 12
  const keywordCounts = new Map<string, number>()
  const pulse: TranscriptLensPulse = { questions: 0, agreements: 0, disagreements: 0, concerns: 0 }
  const activity = new Map<string, { segmentCount: number; textLength: number }>()

  for (const g of groups) activity.set(g.id, { segmentCount: 0, textLength: 0 })

  for (const s of segments) {
    for (const token of tokenizeForKeywords(s.text)) {
      keywordCounts.set(token, (keywordCounts.get(token) ?? 0) + 1)
    }
    if (isQuestion(s.text)) pulse.questions += 1
    if (isAgreement(s.text)) pulse.agreements += 1
    if (isDisagreement(s.text)) pulse.disagreements += 1
    if (isConcern(s.text)) pulse.concerns += 1

    if (s.groupId) {
      const prev = activity.get(s.groupId) ?? { segmentCount: 0, textLength: 0 }
      activity.set(s.groupId, { segmentCount: prev.segmentCount + 1, textLength: prev.textLength + s.text.length })
    }
  }

  const maxKeyword = Math.max(1, ...keywordCounts.values())
  const keywords = Array.from(keywordCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, keywordLimit)
    .map(([term, count]) => ({ term, count, weight: count / maxKeyword }))

  const totalTextLength = Math.max(1, Array.from(activity.values()).reduce((sum, g) => sum + g.textLength, 0))
  const groupActivity = groups.map((g) => {
    const v = activity.get(g.id) ?? { segmentCount: 0, textLength: 0 }
    return { groupId: g.id, label: g.label, segmentCount: v.segmentCount, textLength: v.textLength, share: v.textLength / totalTextLength }
  })

  return { keywords, groupActivity, pulse }
}

function tokenizeForKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

function isQuestion(text: string): boolean {
  return /[?？]|왜|어떻게|무엇|뭐가|가능할까요|필요할까요|문제인가/.test(text)
}

function isAgreement(text: string): boolean {
  return /동의|찬성|맞습니다|좋습니다|필요합니다|agree|yes/.test(text.toLowerCase())
}

function isDisagreement(text: string): boolean {
  return /반대|동의하지|아닙니다|어렵습니다|불가능|disagree|no\b/.test(text.toLowerCase())
}

function isConcern(text: string): boolean {
  return /우려|걱정|리스크|위험|문제|부담|비용|예산|concern|risk|cost/.test(text.toLowerCase())
}
