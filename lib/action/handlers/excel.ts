import { z } from 'zod'
import { excel } from '@/lib/db/repo'
import { envelopeToCtx } from '../context'
import type { Handler } from './types'

const OpenInput = z.object({
  sessionId: z.string(),
  templateId: z.string()
})

export const openCollaborativeExcel: Handler = async ({ envelope }) => {
  const input = OpenInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const tpl = await excel.getTemplate(ctx, input.templateId)
  if (!tpl || tpl.session_id !== input.sessionId) throw new Error('template not found')
  const cells = await excel.listCells(ctx, tpl.id)
  return { data: { template: tpl, cells }, summary: `excel open ${tpl.id} cells=${cells.length}` }
}

const UpdateCellInput = z.object({
  sessionId: z.string(),
  templateId: z.string(),
  sheetName: z.string().default('Sheet1'),
  cellRef: z.string(),
  value: z.string()
})

export const updateExcelCell: Handler = async ({ envelope }) => {
  const input = UpdateCellInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const row = await excel.upsertCell(ctx, {
    template_id: input.templateId,
    sheet_name: input.sheetName,
    cell_ref: input.cellRef,
    value: input.value,
    updated_by: envelope.actor.userId ?? envelope.actor.role
  })
  return { data: { id: row.id, cellRef: row.cell_ref }, summary: `cell ${row.cell_ref}` }
}
