import { describe, it, expect } from 'vitest'
import { listSeatLayoutTemplates, upsertSeatLayoutTemplate, applySeatLayoutTemplate } from '@/lib/action/handlers/seatmap'
import { seatLayoutTemplates, seatLayouts } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { buildLectureT8SeatLayout } from '@/lib/seatmap/layout'

// vitest용 mock envelope helper
import type { AxActionEnvelope } from '@/lib/action/envelope'

const mockEnvelope = (action: string, input: Record<string, any>, role: 'admin' | 'instructor' | 'assistant' = 'admin'): AxActionEnvelope => ({
  action,
  actor: { type: 'human', role, tool: 'web-ui' },
  scope: { sessionId: input.sessionId ?? '' },
  idempotencyKey: 'test-key',
  redactionPolicy: 'summary',
  dryRun: false,
  input
})


describe('Seat Layout Templates Action Handlers — 템플릿 제어 액션 검증', () => {
  const ctx = adminContext()

  it('1) listSeatLayoutTemplates는 등록된 템플릿 목록을 반환해야 함', async () => {
    const res = await listSeatLayoutTemplates({ envelope: mockEnvelope('liveops.list_seat_layout_templates', {}) })
    expect(res.data).toBeDefined()
    expect((res.data as any).list).toHaveLength(3) // t8, t5, eight-team 시드
    expect((res.data as any).list.map((item: { slug: string }) => item.slug)).toContain('lecture-t8-332')
  })

  it('2) upsertSeatLayoutTemplate은 새 템플릿을 추가/수정해야 함', async () => {
    const customConfig = buildLectureT8SeatLayout()
    const res = await upsertSeatLayoutTemplate({
      envelope: mockEnvelope('liveops.upsert_seat_layout_template', {
        slug: 'custom-tpl-preset',
        name: '커스텀 테스트 프리셋',
        description: '단위 테스트용 템플릿',
        layout: customConfig
      })
    })
    expect(res.data).toBeDefined()
    expect((res.data as any).slug).toBe('custom-tpl-preset')

    const list = await seatLayoutTemplates.list(ctx)
    expect(list.some((t) => t.slug === 'custom-tpl-preset')).toBe(true)
  })

  it('3) applySeatLayoutTemplate은 템플릿을 특정 세션에 active layout으로 복사 적용해야 함', async () => {
    const sessionId = 'se-002-DEMO'

    // 템플릿 적용 액션 실행
    const res = await applySeatLayoutTemplate({
      envelope: mockEnvelope('liveops.apply_seat_layout_template', {
        sessionId,
        templateId: 'slt-t8-332',
        nameOverride: '세션 2 배포 레이아웃'
      }, 'instructor')
    })

    expect(res.data).toBeDefined()
    expect((res.data as any).name).toBe('세션 2 배포 레이아웃')

    // DB에 해당 세션의 active layout이 잘 저장되었는지 조회
    const activeLayout = await seatLayouts.getBySession(ctx, sessionId)
    expect(activeLayout).toBeDefined()
    expect(activeLayout?.name).toBe('세션 2 배포 레이아웃')
    expect(activeLayout?.layout.tables).toHaveLength(8) // t8 템플릿 조립 확인
  })
})

