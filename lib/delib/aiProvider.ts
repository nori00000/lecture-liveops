// Lecture LiveOps — Q2 "검토가 필요한 주장" 후보 생성 provider 어댑터
// 근거: docs/DELIBERATION-QUALITY-PLAN.md §2 Q2 · §3 아키텍처.
//
// 절대 규칙 (§1/§3):
//   * 이 산출물은 **참가자 화면·프로젝터에 절대 노출되지 않는다**. 콘솔(operator) + 승인된 것만 리포트.
//   * 개인·진영 라벨 금지. "이 발언은 틀렸다"가 아니라 "근거 확인이 필요해 보입니다 + 제안 질문".
//   * AI 를 크리티컬 패스에 올리지 않는다 — 어떤 provider 든 실패하면 **빈 배열 + 로그**, throw 금지.
//     (정책 위반은 예외 — assertProviderAllowed 가 호출 전에 거부한다.)
//
// provider 3종:
//   stub     기본값. LLM 호출 0, 결정론적 규칙. 개발·테스트·데모는 전부 이걸로 검증한다(API 비용 0).
//   local    m4-studio Ollama 등 사내 HTTP 엔드포인트(DELIB_LOCAL_LLM_URL). 미설정이면 stub 로 폴백.
//   external 외부 LLM API. privacy_settings.offsiteProcessing === true + env 설정이 없으면 **거부**.

import { isIP } from 'node:net'
import type { EvidenceKind } from '@/lib/db/schema'

export type AiProvider = 'stub' | 'local' | 'external'
export type ObservationKind = 'evidence_check' | 'definition_mismatch'

export type ObservationCandidate = {
  statementId: string
  kind: ObservationKind
  body: string
  suggestedQuestion: string
}

export type AnalyzeStatementInput = {
  id: string
  body: string
  evidenceKind: EvidenceKind | null
}

export type AnalyzeInput = {
  provider: AiProvider
  statements: AnalyzeStatementInput[]
  // 오프사이트(현장 박스 밖) 처리 동의 여부. external provider 의 유일한 통과 조건.
  offsiteProcessing: boolean
}

// ClaimBuster 근거(§2 Q2): 전수가 아니라 **랭킹 상위 소수**만 제시해야 실용적이다.
const MAX_CANDIDATES = 10
const TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 1_000_000
const MAX_BODY_CHARS = 500
const MAX_QUESTION_CHARS = 200
const MAX_TEXT_LINES = 6
const FORMULA_PREFIX = /^[=+\-@]/
const MARKDOWN_STRUCTURES = /[`*_#[\]()>|]/g

// ------------------------------------------------------------
// stub — 결정론적 규칙 (LLM 호출 0)
// ------------------------------------------------------------

// 규칙 1 (evidence_check): 단정 표현 또는 수치 주장이 있으면서
//   근거 유형이 '추정'(estimate)이거나 미지정(null)인 발언.
//   → 자기 태깅(Q1)으로 이미 "미검증"이라고 표시된 주장 중 단정·수치가 섞인 것만 고른다.
const ASSERTIVE_MARKERS = ['당연히', '무조건', '다들', '항상', '절대'] as const
// 수치 주장: 숫자 + 단위/조사. "3%", "2배", "100명", "5억" 등.
const NUMERIC_CLAIM = /\d+(?:[.,]\d+)?\s*(%|퍼센트|배|명|억|만|천|원|건|년|개)/

// 규칙 2 (definition_mismatch): 사람마다 다르게 이해하는 평가어가 있는데
//   같은 발언 안에 정의를 밝히는 표현("정의", "즉", "라 함은")이 없는 경우.
//   근거 유형과 무관하다 — 용어 불일치는 근거의 종류와 별개의 문제다.
const AMBIGUOUS_TERMS = ['공정', '효율', '정상', '제대로', '진짜', '합리적', '지속가능', '활성화'] as const
const DEFINITION_MARKERS = ['정의', '즉,', '즉 ', '라 함은', '이란 ', '란 ']

function firstMatch(body: string, terms: readonly string[]): string | null {
  for (const t of terms) {
    if (body.includes(t)) return t
  }
  return null
}

// 근거 확인 후보 문구 — 판정이 아니라 확인 요청 톤. 개인·진영 지칭 없음.
function evidenceCheckCandidate(s: AnalyzeStatementInput): ObservationCandidate | null {
  const unverified = s.evidenceKind === 'estimate' || s.evidenceKind == null
  if (!unverified) return null
  const marker = firstMatch(s.body, ASSERTIVE_MARKERS)
  const numeric = NUMERIC_CLAIM.exec(s.body)
  if (!marker && !numeric) return null
  const cue = marker
    ? `단정적 표현("${marker}")이 쓰였습니다`
    : `수치 주장("${numeric![0].trim()}")이 포함되어 있습니다`
  const tagText = s.evidenceKind === 'estimate' ? "근거 유형이 '추정'으로 표시되어 있습니다" : '근거 유형이 표시되지 않았습니다'
  return {
    statementId: s.id,
    kind: 'evidence_check',
    body: `${cue}. ${tagText}. 근거 확인이 필요해 보입니다.`,
    suggestedQuestion: '이 주장을 뒷받침하는 자료나 직접 겪은 사례를 하나만 들어주실 수 있을까요?'
  }
}

function definitionMismatchCandidate(s: AnalyzeStatementInput): ObservationCandidate | null {
  const term = firstMatch(s.body, AMBIGUOUS_TERMS)
  if (!term) return null
  if (DEFINITION_MARKERS.some((m) => s.body.includes(m))) return null
  return {
    statementId: s.id,
    kind: 'definition_mismatch',
    body: `'${term}'은(는) 참여자마다 다르게 이해할 수 있는 표현입니다. 용어 정의를 맞출 필요가 있어 보입니다.`,
    suggestedQuestion: `여기서 말하는 '${term}'을(를) 한 문장으로 정의해주실 수 있을까요?`
  }
}

// 결정론: 입력 순서 → 발언당 evidence_check → definition_mismatch 순으로 담고 상한에서 자른다.
// 같은 입력이면 언제 몇 번을 돌려도 같은 배열이 나온다 (테스트가 이를 검증한다).
export function stubAnalyze(statements: AnalyzeStatementInput[]): ObservationCandidate[] {
  const out: ObservationCandidate[] = []
  for (const s of statements) {
    for (const c of [evidenceCheckCandidate(s), definitionMismatchCandidate(s)]) {
      if (c && out.length < MAX_CANDIDATES) out.push(c)
    }
  }
  return out
}

// ------------------------------------------------------------
// provider 해석 · 정책 게이트
// ------------------------------------------------------------

export function resolveProvider(raw?: string | null): AiProvider {
  const v = raw ?? process.env.DELIB_AI_PROVIDER ?? 'stub'
  return v === 'local' || v === 'external' ? v : 'stub'
}

export function externalConfigured(): boolean {
  return Boolean(process.env.DELIB_EXTERNAL_LLM_URL && process.env.DELIB_EXTERNAL_LLM_API_KEY)
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

function isAllowedLocalHostname(hostname: string): boolean {
  const host = stripIpv6Brackets(hostname)
  if (host === 'localhost' || host === '::1') return true
  if (host.endsWith('.ts.net')) return true
  if (isIP(host) === 4) {
    const parts = host.split('.').map((p) => Number(p))
    if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false
    const [a, b] = parts
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  return false
}

function assertLocalProviderUrlAllowed(rawUrl: string): void {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('delib: local ai provider url is invalid')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('delib: local ai provider url must use http or https')
  }
  if (url.username || url.password) {
    throw new Error('delib: local ai provider url must not include credentials')
  }
  if (!isAllowedLocalHostname(url.hostname)) {
    throw new Error('delib: local ai provider url host is not allowed')
  }
}

// 정책 위반은 **거부**한다 (빈 배열이 아니라 예외) — 전사 설계와 동일 원칙.
// 호출자(액션)가 이걸 먼저 부르고, provider 내부에서도 2차로 재확인한다.
export function assertProviderAllowed(provider: AiProvider, opts: { offsiteProcessing: boolean }): void {
  if (provider === 'local') {
    const url = process.env.DELIB_LOCAL_LLM_URL
    // 미설정은 stub 폴백 경로이므로 허용한다. 설정된 URL 만 로컬/사설망 allowlist 로 제한한다.
    if (url) assertLocalProviderUrlAllowed(url)
    return
  }
  if (provider !== 'external') return
  if (opts.offsiteProcessing !== true) {
    throw new Error('delib: external ai provider requires offsite processing consent')
  }
  if (!externalConfigured()) {
    throw new Error('delib: external ai provider not configured')
  }
}

// ------------------------------------------------------------
// HTTP provider 공통 — 응답 파싱은 방어적으로. 알 수 없는 값은 버린다.
// ------------------------------------------------------------

function sanitizeProviderText(value: string, maxChars: number): string {
  const lines = value
    .trim()
    .split(/\r?\n/)
    .slice(0, MAX_TEXT_LINES)
    .map((line) => line.replace(MARKDOWN_STRUCTURES, '').trim())
    .filter(Boolean)
  let text = lines.join(' ').slice(0, maxChars).trim()
  if (FORMULA_PREFIX.test(text)) text = `'${text}`
  if (text.length > maxChars) text = text.slice(0, maxChars).trim()
  return text
}

function parseCandidates(raw: unknown, allowedIds: Set<string>): ObservationCandidate[] {
  if (!Array.isArray(raw)) return []
  const out: ObservationCandidate[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const statementId = typeof o.statementId === 'string' ? o.statementId : ''
    const kind = o.kind === 'evidence_check' || o.kind === 'definition_mismatch' ? o.kind : null
    const body = typeof o.body === 'string' ? sanitizeProviderText(o.body, MAX_BODY_CHARS) : ''
    const suggestedQuestion =
      typeof o.suggestedQuestion === 'string' ? sanitizeProviderText(o.suggestedQuestion, MAX_QUESTION_CHARS) : ''
    // 입력에 없던 발언을 지어낸 응답은 버린다 (환각 statementId 차단).
    if (!statementId || !allowedIds.has(statementId) || !kind || !body) continue
    out.push({ statementId, kind, body, suggestedQuestion })
    if (out.length >= MAX_CANDIDATES) break
  }
  return out
}

const SYSTEM_PROMPT = [
  '너는 숙의 워크숍 퍼실리테이터의 사후 검토 보조다. 참가자에게는 절대 보이지 않는 초안을 만든다.',
  '각 발언에 대해 "근거 확인이 필요해 보이는가"만 판단한다. 옳고 그름을 판정하지 마라.',
  '개인·진영·정치성향을 지칭하지 마라. "이 발언은 틀렸다" 같은 표현 금지.',
  '출력은 JSON 배열 하나만. 형식: [{"statementId":string,"kind":"evidence_check"|"definition_mismatch","body":string,"suggestedQuestion":string}]',
  '해당 없으면 빈 배열 []. 확신이 없으면 넣지 마라(정밀도 우선).'
].join('\n')

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function readCappedResponseText(res: Response): Promise<string | null> {
  const contentLength = res.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_RESPONSE_BYTES) return null
  if (!res.body) {
    const text = await res.text()
    return Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES ? null : text
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

// chat-completions 호환 endpoint 호출. 실패는 전부 [] (호출자를 깨지 않는다).
async function httpAnalyze(
  label: string,
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
  statements: AnalyzeStatementInput[]
): Promise<ObservationCandidate[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const userPayload = JSON.stringify(
      statements.map((s) => ({ statementId: s.id, body: s.body, evidenceKind: s.evidenceKind ?? 'unspecified' }))
    )
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPayload }
        ]
      }),
      signal: controller.signal,
      redirect: 'manual'
    })
    if (!res.ok) {
      // 응답 원문·키는 로그에 남기지 않는다 (상태코드만).
      console.error(`[delib-ai:${label}] http error status=${res.status}`)
      return []
    }
    const text = await readCappedResponseText(res)
    if (text == null) {
      console.error(`[delib-ai:${label}] response too large`)
      return []
    }
    const json = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> }
    const content = json.choices?.[0]?.message?.content
    if (typeof content !== 'string') {
      console.error(`[delib-ai:${label}] unexpected response shape`)
      return []
    }
    return parseCandidates(extractJsonArray(content), new Set(statements.map((s) => s.id)))
  } catch (e) {
    console.error(`[delib-ai:${label}] call failed: ${e instanceof Error ? e.name : 'unknown'}`)
    return []
  } finally {
    clearTimeout(timer)
  }
}

// ------------------------------------------------------------
// 공개 인터페이스 — 어떤 경우에도 throw 하지 않는다.
// ------------------------------------------------------------
export async function analyzeStatements(input: AnalyzeInput): Promise<ObservationCandidate[]> {
  if (input.statements.length === 0) return []
  if (input.provider === 'local' && process.env.DELIB_LOCAL_LLM_URL) {
    assertLocalProviderUrlAllowed(process.env.DELIB_LOCAL_LLM_URL)
  }
  try {
    if (input.provider === 'external') {
      // 2차 방어 — 액션에서 이미 거부되지만, 동의 없는 오프사이트 전송은 여기서도 막는다.
      if (input.offsiteProcessing !== true || !externalConfigured()) {
        console.error('[delib-ai:external] refused — offsite consent or config missing')
        return []
      }
      return await httpAnalyze(
        'external',
        process.env.DELIB_EXTERNAL_LLM_URL!,
        process.env.DELIB_EXTERNAL_LLM_API_KEY,
        process.env.DELIB_EXTERNAL_LLM_MODEL ?? 'gpt-4o-mini',
        input.statements
      )
    }
    if (input.provider === 'local') {
      const url = process.env.DELIB_LOCAL_LLM_URL
      // 미설정이면 stub 로 폴백 — 로컬 모델이 없다고 기능이 죽지 않는다.
      if (!url) return stubAnalyze(input.statements)
      return await httpAnalyze(
        'local',
        url,
        process.env.DELIB_LOCAL_LLM_API_KEY,
        process.env.DELIB_LOCAL_LLM_MODEL ?? 'local-model',
        input.statements
      )
    }
    return stubAnalyze(input.statements)
  } catch (e) {
    // 규칙 엔진까지 실패해도 상위(리포트·결과판)를 깨뜨리지 않는다.
    console.error(`[delib-ai] analyze failed: ${e instanceof Error ? e.name : 'unknown'}`)
    return []
  }
}
