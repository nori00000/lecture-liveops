// Lecture LiveOps — assist 공유 타입 (트랙 A 명령 파서 ↔ 트랙 B LLM fallback 계약)
// 이 타입은 /api/assist(트랙 A)와 lib/assist/llm.ts(트랙 B)가 공유한다. 필드 변경 금지.

export type AssistPlan = {
  intent: 'problem' | 'resolved' | 'clear'
  seatKeys: string[]
  reason?: string
  memo?: string
  unmatched: string[]
}
