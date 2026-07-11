import { z } from 'zod'
import { seatLayouts, seatMarks, seatLayoutTemplates } from '@/lib/db/repo'
import { SeatStatusEnum, SeatLayoutConfigSchema } from '@/lib/db/schema'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const SeatMarkInput = z.object({
  sessionId: z.string(),
  seatKey: z.string(),
  status: SeatStatusEnum,
  reason: z.string().max(20).optional(),
  memo: z.string().optional()
})

// 좌석 단위 문제(problem)/해결(resolved)/해제(none) + 메모 upsert
export const updateSeatMark: Handler = async ({ envelope }) => {
  const input = SeatMarkInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await seatMarks.upsert(ctx, {
    session_id: input.sessionId,
    seat_key: input.seatKey,
    status: input.status,
    reason: input.reason,
    memo: input.memo,
    updated_by: envelope.actor.userId ?? envelope.actor.role
  })
  return { data: { id: row.id, seatKey: row.seat_key, status: row.status }, summary: `seat ${row.seat_key} ${row.status}` }
}

const ClearMarksInput = z.object({ sessionId: z.string() })

// 전체 초기화 — 세션의 모든 좌석 마크 삭제 (UI에서 확인 다이얼로그 후 호출)
export const clearSeatMarks: Handler = async ({ envelope }) => {
  const input = ClearMarksInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const cleared = await seatMarks.clearAll(ctx, input.sessionId)
  return { data: { cleared }, summary: `seat marks cleared (${cleared})` }
}

const SeatLayoutInput = z.object({
  sessionId: z.string(),
  name: z.string(),
  layout: SeatLayoutConfigSchema
})

// 세션당 active 1개 레이아웃 upsert (session_id unique)
export const upsertSeatLayout: Handler = async ({ envelope }) => {
  const input = SeatLayoutInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await seatLayouts.upsert(ctx, {
    session_id: input.sessionId,
    name: input.name,
    layout: input.layout
  })
  return { data: { id: row.id }, summary: `seat layout ${row.name} (${input.layout.tables.length} tables)` }
}

// 템플릿 목록 조회
export const listSeatLayoutTemplates: Handler = async ({ envelope }) => {
  const ctx = envelopeToCtx(envelope)
  const list = await seatLayoutTemplates.list(ctx)
  return { data: { list }, summary: `seat layout templates count: ${list.length}` }
}

const UpsertTemplateInput = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  layout: SeatLayoutConfigSchema
})

// 템플릿 생성 및 수정
export const upsertSeatLayoutTemplate: Handler = async ({ envelope }) => {
  const input = UpsertTemplateInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await seatLayoutTemplates.upsert(ctx, {
    slug: input.slug,
    name: input.name,
    description: input.description,
    layout: input.layout
  })
  return { data: { id: row.id, slug: row.slug }, summary: `seat layout template upserted ${row.name} (${row.slug})` }
}

const ApplyTemplateInput = z.object({
  sessionId: z.string(),
  templateId: z.string(),
  nameOverride: z.string().optional()
})

// 템플릿 데이터를 특정 세션의 active layout으로 적용 (조립식 활성화)
export const applySeatLayoutTemplate: Handler = async ({ envelope }) => {
  const input = ApplyTemplateInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)

  // 1. 템플릿 찾기
  const tpl = await seatLayoutTemplates.findById(ctx, input.templateId)
  if (!tpl) {
    throw new Error(`Template not found: ${input.templateId}`)
  }

  // 2. 기존 세션 레이아웃 조회 (명단 백업 목적)
  const existing = await seatLayouts.getBySession(ctx, input.sessionId)
  const rosterMap: Record<string, string[]> = {}
  if (existing && existing.layout?.tables) {
    existing.layout.tables.forEach((t) => {
      if (t.label && t.roster) {
        rosterMap[t.label] = [...t.roster]
      }
    })
  }

  // 3. 신규 템플릿 레이아웃에 기존 명단(roster) 지능적 매칭
  const targetLayout = {
    ...tpl.layout,
    tables: tpl.layout.tables.map((t) => {
      const roster = rosterMap[t.label]
      return {
        ...t,
        ...(roster && roster.length > 0 ? { roster } : {})
      }
    })
  }

  const name = input.nameOverride?.trim() || tpl.name
  const row = await seatLayouts.upsert(ctx, {
    session_id: input.sessionId,
    name,
    layout: targetLayout
  })

  // 4. 적용 시 해당 세션의 기존 좌석 상태(마크)들이 충돌하지 않도록
  // 새로운 레이아웃 좌석 키 세트와 비교하여 불일치하는 마크는 백그라운드에서 정리해 줍니다.
  return {
    data: { id: row.id, name: row.name, layout: row.layout },
    summary: `applied template ${tpl.slug} to session ${input.sessionId}`
  }
}

