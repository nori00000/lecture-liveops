import ExcelJS from 'exceljs'
import { excel } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

export async function exportSessionExcelBuffer(sessionId: string, templateId?: string): Promise<Buffer> {
  const ctx = adminContext(sessionId)
  const tpls = templateId
    ? ([await excel.getTemplate(ctx, templateId)].filter(Boolean) as Array<NonNullable<Awaited<ReturnType<typeof excel.getTemplate>>>>)
    : await excel.listTemplates(ctx, sessionId)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lecture LiveOps'
  wb.created = new Date()
  for (const tpl of tpls) {
    const ws = wb.addWorksheet((tpl.title ?? 'Sheet').slice(0, 28) || 'Sheet')
    const cells = await excel.listCells(ctx, tpl.id)
    for (const c of cells) {
      ws.getCell(c.cell_ref).value = c.value
    }
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
