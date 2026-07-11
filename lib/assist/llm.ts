// Lecture LiveOps — env 플러그인 LLM fallback (트랙 B)
// 결정론 파서가 처리 못 한 복합 좌석 명령을 표준 chat-completions 호환 endpoint로 구조화한다.
// fail-closed: env 미설정·HTTP 오류·timeout·검증 실패 전부 null → 결정론 파서만으로 동작.
// 보안: API 키와 응답 원문은 어떤 로그/응답에도 출력하지 않는다 (상태코드만).

import { z } from 'zod'
import type { AssistPlan } from './types'

const TIMEOUT_MS = 25_000
const DEFAULT_MODEL = 'local-model'

// AssistPlan 검증 스키마 — lib/db/schema import 금지(계약 격리), z로 직접 정의.
// LLM이 null을 섞어 보내는 경우가 흔해 nullish로 받고 undefined로 정규화한다.
const AssistPlanSchema = z.object({
  intent: z.enum(['problem', 'resolved', 'clear']),
  seatKeys: z.array(z.string()),
  reason: z.string().nullish(),
  memo: z.string().nullish(),
  unmatched: z.array(z.string()).nullish()
})

function extractJson(text: string): unknown | null {
  // response_format(json_object) 미준수 대비: 본문에서 첫 { ~ 마지막 } 추출
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export async function runLlmFallback(args: {
  text: string
  sessionId: string
  seatKeys: string[]
}): Promise<AssistPlan | null> {
  const baseUrl = process.env.LIVEOPS_LLM_BASE_URL
  const apiKey = process.env.LIVEOPS_LLM_API_KEY
  const model = process.env.LIVEOPS_LLM_MODEL ?? DEFAULT_MODEL
  // env 미설정 → 즉시 null (fail-closed, 외부 호출 0)
  if (!baseUrl || !apiKey) return null

  const system = [
    '너는 강의 좌석 보드 운영 보조다. 사용자의 한국어 좌석 명령을 JSON 하나로 구조화하라.',
    '출력은 반드시 JSON 객체 하나만. 설명·마크다운·코드펜스 금지.',
    'JSON 스키마: {"intent":"problem|resolved|clear","seatKeys":string[],"reason"?:string,"memo"?:string,"unmatched":string[]}',
    '- intent: 문제 표시=problem, 해결 표시=resolved, 표시 해제/초기화=clear',
    '- seatKeys: 아래 유효 좌석 목록에 있는 키만 넣는다. 목록에 없는 좌석 표현은 unmatched에 원문 그대로 넣는다.',
    '- reason: 반드시 install|network|account|pace|device|etc 중 하나 (설치=install, 네트워크/SSL=network, 계정/구독=account, 진도=pace, 기기=device, 그 외=etc; 없으면 생략)',
    '- memo: 사유 외 자유 메모 (없으면 생략)',
    `유효 seatKeys: ${JSON.stringify(args.seatKeys)}`
  ].join('\n')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: args.text }
        ]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      // 응답 원문/키 미출력 — 상태코드만
      console.error(`[assist-llm] http error status=${res.status}`)
      return null
    }
    const body: unknown = await res.json().catch(() => null)
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)
      ?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null

    const json = extractJson(content)
    if (json == null) return null
    const parsed = AssistPlanSchema.safeParse(json)
    if (!parsed.success) return null

    // allowlist 강제: 유효 목록 밖 seatKey는 unmatched로 강등 (LLM이 임의 좌석을 만들지 못하게)
    const valid = new Set(args.seatKeys)
    const seatKeys = parsed.data.seatKeys.filter((k) => valid.has(k))
    const demoted = parsed.data.seatKeys.filter((k) => !valid.has(k))
    return {
      intent: parsed.data.intent,
      seatKeys,
      reason: normalizeReason(parsed.data.reason),
      memo: parsed.data.memo ?? undefined,
      unmatched: [...(parsed.data.unmatched ?? []), ...demoted]
    }
  } catch (e: unknown) {
    // timeout(AbortError)·네트워크 오류 — 오류명만 기록, 메시지/키/원문 미출력
    const name = e instanceof Error ? e.name : 'unknown'
    console.error(`[assist-llm] request failed (${name})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const REASON_KEYS = new Set(['install', 'network', 'account', 'pace', 'device', 'etc'])
const REASON_KEYWORDS: Array<[RegExp, string]> = [
  [/설치/, 'install'],
  [/네트워크|ssl|와이파이|인터넷/i, 'network'],
  [/계정|구독|로그인/, 'account'],
  [/진도|느[리려림]|못\s*따라/, 'pace'],
  [/기기|노트북|장비/, 'device']
]

// LLM이 enum 키 대신 자유 텍스트 사유를 줄 때 키로 정규화 — 매핑 불가면 etc.
function normalizeReason(reason: string | null | undefined): string | undefined {
  if (!reason) return undefined
  if (REASON_KEYS.has(reason)) return reason
  for (const [re, key] of REASON_KEYWORDS) {
    if (re.test(reason)) return key
  }
  return 'etc'
}
