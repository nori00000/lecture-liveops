import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runLlmFallback } from '@/lib/assist/llm'

const ARGS = {
  text: '3번 테이블 두번째 자리 로그인 문제, T9-1은 해결',
  sessionId: 'se-001-DEMO',
  seatKeys: ['T3-2', 'T9-1']
}

const FAKE_KEY = 'test-key-do-not-log'

function okResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }] })
  } as unknown as Response
}

describe('assist llm fallback', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('env(BASE_URL/API_KEY) 없으면 fetch 호출 없이 즉시 null (fail-closed)', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', '')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    expect(await runLlmFallback(ARGS)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('정상 JSON 응답이면 AssistPlan을 반환하고 allowlist 밖 seatKey는 unmatched로 강등한다', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', 'https://llm.example.com/v1')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', FAKE_KEY)
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(
        JSON.stringify({
          intent: 'problem',
          seatKeys: ['T3-2', 'T99-9'],
          reason: '로그인',
          memo: null,
          unmatched: ['앞줄 누군가']
        })
      )
    )
    vi.stubGlobal('fetch', fetchMock)

    const plan = await runLlmFallback(ARGS)
    expect(plan).toEqual({
      intent: 'problem',
      seatKeys: ['T3-2'],
      reason: 'account', // normalizeReason: '로그인' → account
      memo: undefined,
      unmatched: ['앞줄 누군가', 'T99-9']
    })

    // OpenAI 호환 endpoint로 호출 + Authorization header 사용 확인
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://llm.example.com/v1/chat/completions')
    const body = JSON.parse(String(init.body)) as { model: string; messages: Array<{ content: string }> }
    expect(body.model).toBe('local-model')
    expect(body.messages[0].content).toContain('T3-2')
  })

  it('마크다운 코드펜스로 감싼 JSON도 첫 { ~ 마지막 } 추출로 파싱한다', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', 'https://llm.example.com/v1')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', FAKE_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse('```json\n{"intent":"clear","seatKeys":[],"unmatched":[]}\n```')
      )
    )

    const plan = await runLlmFallback(ARGS)
    expect(plan?.intent).toBe('clear')
    expect(plan?.seatKeys).toEqual([])
  })

  it('깨진 JSON / 스키마 불일치 응답은 null', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', 'https://llm.example.com/v1')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', FAKE_KEY)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse('미안하지만 JSON이 아님')))
    expect(await runLlmFallback(ARGS)).toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse('{"intent":"explode","seatKeys":"not-array"}'))
    )
    expect(await runLlmFallback(ARGS)).toBeNull()
  })

  it('HTTP 오류는 null이고 로그에 API 키를 노출하지 않는다', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', 'https://llm.example.com/v1')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', FAKE_KEY)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response)
    )

    expect(await runLlmFallback(ARGS)).toBeNull()
    const logged = errSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('401')
    expect(logged).not.toContain(FAKE_KEY)
  })

  it('25초 timeout이면 abort 후 null', async () => {
    vi.stubEnv('LIVEOPS_LLM_BASE_URL', 'https://llm.example.com/v1')
    vi.stubEnv('LIVEOPS_LLM_API_KEY', FAKE_KEY)
    vi.useFakeTimers()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'))
          })
        })
      })
    )

    const pending = runLlmFallback(ARGS)
    await vi.advanceTimersByTimeAsync(25_001)
    expect(await pending).toBeNull()
    const logged = errSpy.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('AbortError')
    expect(logged).not.toContain(FAKE_KEY)
  })
})
