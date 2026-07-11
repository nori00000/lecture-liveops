import { nowIso } from '@/lib/util/id'
import type { ObservationCategory, StructuredObservation } from './types'

const CATEGORY_RULES: Array<[ObservationCategory, RegExp]> = [
  ['question', /질문|궁금|문의|물어|q&a|Q&A/i],
  ['answer', /답변|응답|안내함|설명함/i],
  ['error', /오류|에러|막힘|안됨|안 됨|실패|문제|접속|로그인|blocked/i],
  ['solution', /해결|우회|시크릿|재시작|새로고침|reload|완료/i],
  ['lecture_speed', /속도|빠름|느림|진도/i],
  ['mood', /분위기|집중|혼란|피곤|좋음|반응/i],
  ['material', /자료|링크|pdf|공유|파일|슬라이드/i],
  ['signal', /신호|알림|콜|호출/i],
  ['followup', /후속|나중|정리|숙제|팔로업/i]
]

function findCategory(text: string): ObservationCategory {
  return CATEGORY_RULES.find(([, re]) => re.test(text))?.[0] ?? 'progress'
}

function findTimeLabel(text: string): string | undefined {
  return text.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/)?.[0]
}

function findTarget(text: string): string | undefined {
  return text.match(/(?:\d+번\s*(?:테이블|조)|table[_\s-]?\d+|[A-Z]\s*조)/i)?.[0]?.replace(/\s+/g, ' ')
}

function findMood(text: string): StructuredObservation['mood'] | undefined {
  if (/혼란|헷갈|어려|막힘|정체/.test(text)) return 'confused'
  if (/집중|몰입|참여|반응 좋|좋음/.test(text)) return 'engaged'
  if (/피곤|지침|졸림/.test(text)) return 'tired'
  if (/멈춤|정체|대기/.test(text)) return 'stalled'
  if (/분위기|좋/.test(text)) return 'good'
  return undefined
}

function findLectureSpeed(text: string): StructuredObservation['lecture_speed'] | undefined {
  if (/빠름|빠른|속도.*빠|진도.*빠/.test(text)) return 'fast'
  if (/느림|천천|속도.*느|진도.*느/.test(text)) return 'slow'
  if (/속도|진도/.test(text)) return 'normal'
  return undefined
}

function findSeverity(text: string): StructuredObservation['severity'] {
  if (/긴급|전체|다수|심각|중단|블로커|blocker/i.test(text)) return 'urgent'
  if (/막힘|오류|에러|실패|안됨|안 됨/.test(text)) return 'high'
  if (/질문|혼란|빠름|느림/.test(text)) return 'medium'
  return 'low'
}

function findSolution(text: string): string | undefined {
  const match = text.match(/((?:시크릿|재로그인|새로고침|reload|재시작|우회|해결)[^。.!?]*)/i)
  return match?.[1]?.trim()
}

// "질문 ... 답변 ..." 한 입력에서 질문과 답변을 분리한다.
// 구분자: 답변/응답/답함/답해/→/->/=>. 앞부분의 '질문/문의/Q' 라벨은 제거.
function findQnA(text: string): { question?: string; answer?: string } {
  const m = text.match(/^([\s\S]*?)\s*(?:답변|응답|답함|답해|=>|->|→)\s*[:：]?\s*([\s\S]+)$/i)
  if (!m) return {}
  const question = m[1]
    .replace(/^\s*(?:질문|문의|궁금|Q)\s*[:：]?\s*/i, '')
    .replace(/\s*(?:라고|이라고)?\s*$/, '')
    .trim()
  const answer = m[2].trim()
  if (question.length >= 2 && answer.length >= 1) return { question, answer }
  return {}
}

// "오류 ... 해결 ..." 한 입력에서 오류와 해결을 분리한다. (질문/답변과 동일 패턴)
// 서술 중 '해결' 오인을 막기 위해 '오류/에러/문제/이슈'로 시작하는 명시 입력만 분리한다.
function findIssueSolution(text: string): { issue?: string; solution?: string } {
  if (!/^\s*(?:오류|에러|문제|이슈|error)/i.test(text)) return {}
  const m = text.match(/^\s*(?:오류|에러|문제|이슈|error)\s*[:：]?\s*([\s\S]*?)\s*(?:해결완료|해결됨|해결|fixed|solved)\s*[:：]?\s*([\s\S]+)$/i)
  if (!m) return {}
  const issue = m[1].trim()
  const solution = m[2].trim()
  if (issue.length >= 2 && solution.length >= 1) return { issue, solution }
  return {}
}

function summarize(text: string, _category: ObservationCategory, target?: string): string {
  // 원문 전체를 보존한다(줄바꿈 포함). 길이 제한은 UI(ObservationTimeline)의 펼쳐보기로 처리.
  const prefix = target ? `${target} · ` : ''
  return `${prefix}${text.trim()}`
}

export function parseRawNote(input: {
  id: string
  sessionId: string
  rawText: string
  visibility?: StructuredObservation['visibility']
  createdAt?: string
}): StructuredObservation {
  const text = input.rawText.trim()
  const qna = findQnA(text)
  const isol: { issue?: string; solution?: string } = qna.question ? {} : findIssueSolution(text)
  // 질문+답변 → 'answer', 오류+해결 → 'solution' 카테고리로 묶는다.
  const category = qna.question && qna.answer ? 'answer' : isol.issue && isol.solution ? 'solution' : findCategory(text)
  const target = findTarget(text)
  const solution = isol.solution ?? findSolution(text)
  const issue = isol.issue
  const question = qna.question ?? (category === 'question' ? text : undefined)
  const observation: StructuredObservation = {
    id: input.id,
    session_id: input.sessionId,
    category,
    time_label: findTimeLabel(text),
    target,
    mood: findMood(text),
    lecture_speed: findLectureSpeed(text),
    severity: findSeverity(text),
    question,
    answer: qna.answer,
    issue,
    solution,
    action_required: undefined,
    visibility: input.visibility ?? 'session',
    summary: summarize(text, category, target),
    confidence: 0.72,
    created_at: input.createdAt ?? nowIso()
  }
  return observation
}

