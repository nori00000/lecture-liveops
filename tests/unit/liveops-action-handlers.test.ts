import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

beforeAll(() => {
  delete process.env.DATABASE_URL
  delete process.env.DATABASE_URL_ANON
  process.env.AX_MODE = 'fixture'
})

import { createLectureSession, ingestRawNote, listSessionDashboard, upsertMaterialVersion } from '@/lib/action/handlers/liveops'
import { resetStore } from '@/lib/db/fixture/store'
import type { AxActionEnvelope } from '@/lib/action/envelope'

function env(action: string, input: unknown, role: 'admin' | 'instructor' | 'assistant' | 'participant' = 'instructor'): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope: { sessionId: 'se-001-DEMO' },
    idempotencyKey: `liveops-${action}-${Math.random()}`,
    redactionPolicy: 'summary',
    dryRun: false,
    input
  }
}

describe('liveops action handlers', () => {
  beforeEach(() => resetStore())

  it('createLectureSession creates date-based enterprise lecture session', async () => {
    const r = await createLectureSession({ envelope: env('liveops.create_lecture_session', { title: 'LG 마곡 Claude Code 실습-DEMO', date: '2026-05-29', companyName: 'LG-DEMO', category: 'Claude Code' }) })
    expect(Boolean(r.data)).toBe(true)
    expect((r.data as { title: string }).title).toContain('Claude Code')
  })

  it('ingestRawNote creates observation and snapshot', async () => {
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: '13:20 2번 테이블 로그인 막힘. 시크릿 모드로 해결. 속도 빠름' }, 'assistant') })
    expect(Boolean(r.data)).toBe(true)
    expect((r.data as { observation: { target?: string } }).observation.target).toBe('2번 테이블')
  })

  it('manual category (분위기) does not leak parser Q/A columns', async () => {
    // 본문에 '답변' 단어가 있어도 '분위기'로 직접 고르면 Q/A로 잘못 분류되면 안 된다.
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: '분위기 좋아요, 다들 답변 잘함', category: 'mood' }, 'assistant') })
    const o = (r.data as { observation: { category: string; question?: string; answer?: string } }).observation
    expect(o.category).toBe('mood')
    expect(o.question ?? null).toBeNull()
    expect(o.answer ?? null).toBeNull()
  })

  it('질문/답변 모드: 명시 필드로 Q/A 컬럼 저장(라벨 누수 없음)', async () => {
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: '외부 API 호출이 막히나요?', question: '외부 API 호출이 막히나요?', answer: '프록시 허용 도메인 등록하면 됩니다.' }, 'assistant') })
    const o = (r.data as { observation: { category: string; question?: string; answer?: string; summary: string } }).observation
    expect(o.category).toBe('answer')
    expect(o.question).toBe('외부 API 호출이 막히나요?')
    expect(o.answer).toBe('프록시 허용 도메인 등록하면 됩니다.')
    // summary·question에 '질문:/답변:' 라벨이 새지 않아야 한다
    expect(o.summary).not.toMatch(/질문:|답변:/)
    expect(o.question).not.toMatch(/^질문:/)
  })

  it('질문만 입력 시 category=question (답변 없음)', async () => {
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: '점심 언제인가요?', question: '점심 언제인가요?' }, 'assistant') })
    const o = (r.data as { observation: { category: string; question?: string; answer?: string } }).observation
    expect(o.category).toBe('question')
    expect(o.question).toBe('점심 언제인가요?')
    expect(o.answer ?? null).toBeNull()
  })

  it('오류/해결 모드: 명시 필드로 issue/solution 컬럼 저장', async () => {
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: 'npm install 실패', issue: 'npm install 실패', solution: '사내 프록시 레지스트리로 해결' }, 'assistant') })
    const o = (r.data as { observation: { category: string; issue?: string; solution?: string; question?: string; summary: string } }).observation
    expect(o.category).toBe('solution')
    expect(o.issue).toBe('npm install 실패')
    expect(o.solution).toBe('사내 프록시 레지스트리로 해결')
    expect(o.question ?? null).toBeNull()
    expect(o.summary).not.toMatch(/오류:|해결:/)
  })

  it('오류만 입력 시 category=error (해결 없음)', async () => {
    const r = await ingestRawNote({ envelope: env('liveops.ingest_raw_note', { sessionId: 'se-001-DEMO', rawText: 'SSL 인증서 오류', issue: 'SSL 인증서 오류' }, 'assistant') })
    const o = (r.data as { observation: { category: string; issue?: string; solution?: string } }).observation
    expect(o.category).toBe('error')
    expect(o.issue).toBe('SSL 인증서 오류')
    expect(o.solution ?? null).toBeNull()
  })

  it('material and dashboard payload are available', async () => {
    await upsertMaterialVersion({ envelope: env('liveops.upsert_material_version', { sessionId: 'se-001-DEMO', title: '실습 링크-DEMO', urlOrStoragePath: 'https://example.com', status: 'shared' }, 'assistant') })
    const r = await listSessionDashboard({ envelope: env('liveops.list_session_dashboard', { sessionId: 'se-001-DEMO' }, 'assistant') })
    expect(Boolean(r.data)).toBe(true)
    expect((r.data as { materials: unknown[] }).materials.length).toBeGreaterThan(0)
  })
})
