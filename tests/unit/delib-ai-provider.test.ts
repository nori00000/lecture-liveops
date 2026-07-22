import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeStatements, assertProviderAllowed } from '@/lib/delib/aiProvider'
import { aiObservations, statements } from '@/lib/db/repo'
import { resetStore } from '@/lib/db/fixture/store'
import { adminContext } from '@/lib/db/neonHelpers'

const SID = 'se-ai-provider-round5'

describe('delib ai provider hardening', () => {
  beforeEach(() => {
    resetStore()
    delete process.env.DELIB_LOCAL_LLM_URL
    delete process.env.DELIB_LOCAL_LLM_API_KEY
    vi.restoreAllMocks()
  })

  afterEach(() => {
    delete process.env.DELIB_LOCAL_LLM_URL
    delete process.env.DELIB_LOCAL_LLM_API_KEY
    vi.unstubAllGlobals()
  })

  it('local provider 는 외부 URL 을 정책 위반으로 거부한다', () => {
    process.env.DELIB_LOCAL_LLM_URL = 'https://api.openai.com/v1'

    expect(() => assertProviderAllowed('local', { offsiteProcessing: false })).toThrow(/host is not allowed/)
  })

  it('analyzeStatements 직접 호출도 local 외부 URL 을 호출 전에 거부한다', async () => {
    process.env.DELIB_LOCAL_LLM_URL = 'https://api.openai.com/v1'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      analyzeStatements({
        provider: 'local',
        offsiteProcessing: false,
        statements: [{ id: 'st-1', body: '항상 확인해야 합니다', evidenceKind: null }]
      })
    ).rejects.toThrow(/host is not allowed/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('local provider 는 allowlist URL 만 호출하고 redirect 를 수동 처리한다', async () => {
    process.env.DELIB_LOCAL_LLM_URL = 'http://127.0.0.1:11434/v1'
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    assertProviderAllowed('local', { offsiteProcessing: false })
    await analyzeStatements({
      provider: 'local',
      offsiteProcessing: false,
      statements: [{ id: 'st-1', body: '당연히 확인해야 합니다', evidenceKind: null }]
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/v1/chat/completions',
      expect.objectContaining({ redirect: 'manual' })
    )
  })

  it('provider 후보 body/question 을 수식·markdown·길이 기준으로 sanitize 한다', async () => {
    process.env.DELIB_LOCAL_LLM_URL = 'http://localhost:11434/v1'
    const longBody = `=HYPERLINK("http://x") ${'x'.repeat(700)}\n# heading\n> quote`
    const longQuestion = `@cmd ${'q'.repeat(260)}`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    {
                      statementId: 'st-1',
                      kind: 'evidence_check',
                      body: longBody,
                      suggestedQuestion: longQuestion
                    }
                  ])
                }
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
      )
    )

    const rows = await analyzeStatements({
      provider: 'local',
      offsiteProcessing: false,
      statements: [{ id: 'st-1', body: '항상 30% 늘었습니다', evidenceKind: null }]
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].body.startsWith("'=")).toBe(true)
    expect(rows[0].suggestedQuestion.startsWith("'@")).toBe(true)
    expect(rows[0].body).toHaveLength(500)
    expect(rows[0].suggestedQuestion).toHaveLength(200)
    expect(rows[0].body).not.toMatch(/[*#>]/)
  })

  it('provider 응답이 1MB 를 넘으면 후보 없이 성공 반환한다', async () => {
    process.env.DELIB_LOCAL_LLM_URL = 'http://localhost:11434/v1'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response('[]', {
          status: 200,
          headers: { 'content-length': '1000001' }
        })
      )
    )

    const rows = await analyzeStatements({
      provider: 'local',
      offsiteProcessing: false,
      statements: [{ id: 'st-1', body: '항상 30% 늘었습니다', evidenceKind: null }]
    })

    expect(rows).toEqual([])
  })
})

describe('delib ai observation repo hardening', () => {
  beforeEach(() => {
    resetStore()
  })

  it('review CAS 의미: 이미 검토된 후보의 두 번째 review 는 실패한다', async () => {
    const ctx = adminContext(SID)
    const [row] = await aiObservations.insertMany(ctx, [
      { session_id: SID, statement_id: 'st-1', kind: 'evidence_check', body: '확인이 필요합니다' }
    ])

    await expect(aiObservations.review(ctx, row.id, 'approved', 'instructor')).resolves.toMatchObject({ status: 'approved' })
    await expect(aiObservations.review(ctx, row.id, 'rejected', 'assistant')).rejects.toThrow(/already reviewed or not found/)
  })

  it('insertMany 는 rejected 가 아닌 동일 후보 중복을 저장하지 않는다', async () => {
    const ctx = adminContext(SID)
    const first = await aiObservations.insertMany(ctx, [
      { session_id: SID, statement_id: 'st-1', kind: 'evidence_check', body: '확인이 필요합니다' },
      { session_id: SID, statement_id: 'st-1', kind: 'evidence_check', body: '중복 후보입니다' }
    ])
    const second = await aiObservations.insertMany(ctx, [
      { session_id: SID, statement_id: 'st-1', kind: 'evidence_check', body: '다시 중복 후보입니다' }
    ])

    expect(first).toHaveLength(1)
    expect(second).toEqual([])
    expect(await aiObservations.list(ctx, SID)).toHaveLength(1)
  })

  it('bulk moderation event 조회는 statement id 별로 묶어서 반환한다', async () => {
    const ctx = adminContext(SID)
    const a = await statements.submit(ctx, {
      session_id: SID,
      round_id: null,
      group_id: null,
      author_participant_id: null,
      body: '발언 A',
      visibility: 'group'
    })
    const b = await statements.submit(ctx, {
      session_id: SID,
      round_id: null,
      group_id: null,
      author_participant_id: null,
      body: '발언 B',
      visibility: 'group'
    })
    await statements.moderate(ctx, a.id, 'flag', 'instructor', '확인 필요')
    await statements.moderate(ctx, a.id, 'hide', 'instructor', '숨김')
    await statements.moderate(ctx, b.id, 'flag', 'assistant', '확인 필요')

    const grouped = await statements.listModerationEventsByStatementIds(ctx, [a.id, b.id, 'missing'])

    expect(grouped[a.id].map((e) => e.action)).toEqual(['flag', 'hide'])
    expect(grouped[b.id].map((e) => e.action)).toEqual(['flag'])
    expect(grouped.missing).toEqual([])
  })
})
