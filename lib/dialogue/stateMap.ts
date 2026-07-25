export type DialogueMirrorSegment = {
  id: string
  groupId: string | null
  speakerTag: string
  startedMs: number
  text: string
  createdAt: string
}

export type OpenQuestion = {
  id: string
  segmentId: string
  text: string
  speakerTag: string
  status: 'open' | 'touched'
  relatedSegmentIds: string[]
  prompt: string
}

export type ConceptThread = {
  term: string
  segmentIds: string[]
  contexts: string[]
  posture: 'steady' | 'needs_definition'
  prompt: string
}

export type EvidenceConnection = {
  segmentId: string
  text: string
  posture: 'connected' | 'waiting'
  hint: string
}

export type TensionAxis = {
  id: string
  label: string
  left: string
  right: string
  leftCount: number
  rightCount: number
  segmentIds: string[]
  prompt: string
}

export type CommonGround = {
  id: string
  label: string
  segmentIds: string[]
  prompt: string
}

export type DialogueStateMap = {
  openQuestions: OpenQuestion[]
  conceptThreads: ConceptThread[]
  evidenceConnections: EvidenceConnection[]
  tensionAxes: TensionAxis[]
  commonGround: CommonGround[]
  hygiene: {
    segmentCount: number
    groupsRepresented: number
    participantFacingCopy: string
  }
}

type AxisSeed = {
  id: string
  label: string
  left: string
  right: string
  leftTerms: string[]
  rightTerms: string[]
}

const AXES: AxisSeed[] = [
  {
    id: 'budget-access',
    label: '예산과 접근성',
    left: '예산·비용',
    right: '접근·이용',
    leftTerms: ['예산', '비용', '재정', '인력', '부담'],
    rightTerms: ['접근', '이용', '야간', '주말', '시간', '거리']
  },
  {
    id: 'speed-safety',
    label: '속도와 신중함',
    left: '빠른 실행',
    right: '신중한 검토',
    leftTerms: ['바로', '즉시', '빠르게', '우선', '시범'],
    rightTerms: ['검토', '안전', '위험', '리스크', '우려', '확인']
  },
  {
    id: 'fairness-responsibility',
    label: '공정성과 책임',
    left: '공정성',
    right: '책임·기준',
    leftTerms: ['공정', '형평', '평등', '소수', '배제'],
    rightTerms: ['책임', '기준', '규칙', '역할', '운영']
  }
]

const CONCEPT_TERMS = ['공정', '형평', '책임', '기준', '안전', '예산', '접근', '효율', '권리', '합의', '소수', '우선순위']
const EVIDENCE_MARKERS = ['근거', '자료', '수치', '조사', '사례', '경험', '데이터', '출처', '왜냐하면', '때문']
const ASSERTION_MARKERS = ['해야', '필요', '맞', '아니', '우선', '채택', '진행', '남기', '정하', '가능', '불가능', '확인']
const AGREEMENT_MARKERS = ['동의', '찬성', '좋', '필요', '같이', '함께', '공통', '합의']

export function buildDialogueStateMap(segments: DialogueMirrorSegment[]): DialogueStateMap {
  const ordered = segments
    .filter((s) => s.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.startedMs - b.startedMs || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  return {
    openQuestions: detectOpenQuestions(ordered),
    conceptThreads: detectConceptThreads(ordered),
    evidenceConnections: detectEvidenceConnections(ordered),
    tensionAxes: detectTensionAxes(ordered),
    commonGround: detectCommonGround(ordered),
    hygiene: {
      segmentCount: ordered.length,
      groupsRepresented: new Set(ordered.map((s) => s.groupId).filter(Boolean)).size,
      participantFacingCopy: 'AI는 발언자를 평가하지 않고, 대화에서 확인해 볼 상태만 보여줍니다.'
    }
  }
}

function detectOpenQuestions(segments: DialogueMirrorSegment[]): OpenQuestion[] {
  return segments
    .filter((s) => isQuestion(s.text))
    .slice(-8)
    .map((q) => {
      const qTokens = meaningfulTokens(q.text)
      const later = segments.filter((s) => s.startedMs > q.startedMs)
      const related = later
        .filter((s) => overlapCount(qTokens, meaningfulTokens(s.text)) > 0 || hasAny(s.text, ['답', '때문', '가능', '하면', '하려면']))
        .slice(0, 3)
      return {
        id: `question:${q.id}`,
        segmentId: q.id,
        text: q.text,
        speakerTag: q.speakerTag,
        status: related.length > 0 ? 'touched' : 'open',
        relatedSegmentIds: related.map((s) => s.id),
        prompt: related.length > 0 ? '이 질문이 어느 정도 다뤄졌는지 확인해 보세요.' : '이 질문에 답할 차례를 만들어 보세요.'
      }
    })
}

function detectConceptThreads(segments: DialogueMirrorSegment[]): ConceptThread[] {
  const out: ConceptThread[] = []
  for (const term of CONCEPT_TERMS) {
    const hits = segments.filter((s) => s.text.includes(term))
    if (hits.length < 2) continue
    const contexts = Array.from(new Set(hits.flatMap((s) => nearbyTokens(s.text, term)).filter((t) => t !== term))).slice(0, 6)
    out.push({
      term,
      segmentIds: hits.map((s) => s.id),
      contexts,
      posture: contexts.length >= 4 || new Set(hits.map((s) => s.groupId ?? s.speakerTag)).size >= 2 ? 'needs_definition' : 'steady',
      prompt: contexts.length >= 4
        ? `"${term}"이 여러 맥락에서 쓰입니다. 지금 의미를 한 문장으로 맞춰 보세요.`
        : `"${term}"의 의미가 안정적으로 반복되고 있습니다.`
    })
  }
  return out.sort((a, b) => b.segmentIds.length - a.segmentIds.length || a.term.localeCompare(b.term)).slice(0, 8)
}

function detectEvidenceConnections(segments: DialogueMirrorSegment[]): EvidenceConnection[] {
  return segments
    .filter((s) => isAssertion(s.text))
    .slice(-10)
    .map((s) => {
      const connected = hasAny(s.text, EVIDENCE_MARKERS)
      return {
        segmentId: s.id,
        text: s.text,
        posture: connected ? 'connected' : 'waiting',
        hint: connected ? '근거 표현이 함께 등장했습니다.' : '근거가 무엇인지 이어서 물어볼 수 있습니다.'
      }
    })
}

function detectTensionAxes(segments: DialogueMirrorSegment[]): TensionAxis[] {
  return AXES.map((axis) => {
    const leftHits = segments.filter((s) => hasAny(s.text, axis.leftTerms))
    const rightHits = segments.filter((s) => hasAny(s.text, axis.rightTerms))
    const ids = Array.from(new Set([...leftHits, ...rightHits].map((s) => s.id)))
    return {
      id: axis.id,
      label: axis.label,
      left: axis.left,
      right: axis.right,
      leftCount: leftHits.length,
      rightCount: rightHits.length,
      segmentIds: ids,
      prompt: ids.length > 0 ? `${axis.left}과 ${axis.right}이 함께 등장합니다. 선택 기준을 분리해 보세요.` : '아직 뚜렷한 갈림 축이 보이지 않습니다.'
    }
  })
    .filter((a) => a.leftCount > 0 && a.rightCount > 0)
    .sort((a, b) => b.segmentIds.length - a.segmentIds.length)
    .slice(0, 3)
}

function detectCommonGround(segments: DialogueMirrorSegment[]): CommonGround[] {
  const buckets = new Map<string, DialogueMirrorSegment[]>()
  for (const s of segments) {
    if (!hasAny(s.text, AGREEMENT_MARKERS)) continue
    for (const t of meaningfulTokens(s.text)) {
      if (t.length < 2) continue
      const prev = buckets.get(t) ?? []
      buckets.set(t, [...prev, s])
    }
  }
  return Array.from(buckets.entries())
    .filter(([, hits]) => hits.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([term, hits]) => ({
      id: `ground:${term}`,
      label: term,
      segmentIds: Array.from(new Set(hits.map((s) => s.id))),
      prompt: `"${term}" 주변에서 공통 표현이 반복됩니다. 합의 문장으로 바꿀 수 있는지 확인해 보세요.`
    }))
}

function isQuestion(text: string): boolean {
  return /[?？]|왜|어떻게|무엇|뭐가|가능할까요|필요할까요|문제인가|어떤/.test(text)
}

function isAssertion(text: string): boolean {
  return !isQuestion(text) && hasAny(text, ASSERTION_MARKERS)
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((t) => text.toLowerCase().includes(t.toLowerCase()))
}

function meaningfulTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t))
}

function overlapCount(a: string[], b: string[]): number {
  const bs = new Set(b)
  return a.filter((t) => bs.has(t)).length
}

function nearbyTokens(text: string, term: string): string[] {
  const tokens = meaningfulTokens(text)
  const out: string[] = []
  tokens.forEach((token, index) => {
    if (!token.includes(term)) return
    out.push(...tokens.slice(Math.max(0, index - 2), index), ...tokens.slice(index + 1, index + 3))
  })
  return out
}
