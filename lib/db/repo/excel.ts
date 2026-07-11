import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, queryOne, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { ExcelTemplate, ExcelCell } from '../schema'

type Row = Record<string, unknown>
function toTemplate(r: Row): ExcelTemplate {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    title: String(r.title),
    version: Number(r.version ?? 1),
    source_resource_id: r.source_resource_id ? String(r.source_resource_id) : null,
    schema_json: (r.schema_json as Record<string, unknown>) ?? {},
    created_at: isoOrString(r.created_at)
  }
}

function toCell(r: Row): ExcelCell {
  return {
    id: String(r.id),
    template_id: String(r.template_id),
    sheet_name: String(r.sheet_name ?? 'Sheet1'),
    cell_ref: String(r.cell_ref),
    value: String(r.value ?? ''),
    formula: String(r.formula ?? ''),
    updated_by: String(r.updated_by ?? ''),
    updated_at: isoOrString(r.updated_at)
  }
}

export const excel = {
  async listTemplates(ctx: RlsContext, sessionId: string): Promise<ExcelTemplate[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.excel_templates} from excel_templates where session_id = $1`, [sessionId])
      return rows.map(toTemplate)
    }
    return getStore().excel_templates.filter((t) => t.session_id === sessionId)
  },
  async getTemplate(ctx: RlsContext, id: string): Promise<ExcelTemplate | undefined> {
    if (isNeonEnabled()) {
      const r = await queryOne(ctx, `select ${COLS.excel_templates} from excel_templates where id = $1`, [id])
      return r ? toTemplate(r) : undefined
    }
    return getStore().excel_templates.find((t) => t.id === id)
  },
  async insertTemplate(ctx: RlsContext, input: Omit<ExcelTemplate, 'id' | 'created_at'> & Partial<Pick<ExcelTemplate, 'id' | 'created_at'>>): Promise<ExcelTemplate> {
    const row: ExcelTemplate = {
      id: input.id ?? newId('ex'),
      session_id: input.session_id,
      title: input.title,
      version: input.version ?? 1,
      source_resource_id: input.source_resource_id ?? null,
      schema_json: input.schema_json ?? {},
      created_at: input.created_at ?? nowIso()
    }
    if (isNeonEnabled()) {
      await query(ctx, `insert into excel_templates (${COLS.excel_templates}) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`,
        [row.id, row.session_id, row.title, row.version, row.source_resource_id, JSON.stringify(row.schema_json), row.created_at])
      return row
    }
    getStore().excel_templates = [...getStore().excel_templates, row]
    bumpRevision()
    return row
  },
  async listCells(ctx: RlsContext, templateId: string): Promise<ExcelCell[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.excel_cells} from excel_cells where template_id = $1`, [templateId])
      return rows.map(toCell)
    }
    return getStore().excel_cells.filter((c) => c.template_id === templateId)
  },
  async upsertCell(ctx: RlsContext, input: { template_id: string; sheet_name: string; cell_ref: string; value: string; updated_by: string }): Promise<ExcelCell> {
    if (isNeonEnabled()) {
      const id = newId('ec')
      const updated_at = nowIso()
      await query(ctx, `insert into excel_cells (id, template_id, sheet_name, cell_ref, value, formula, updated_by, updated_at) values ($1,$2,$3,$4,$5,'',$6,$7) on conflict (template_id, sheet_name, cell_ref) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [id, input.template_id, input.sheet_name, input.cell_ref, input.value, input.updated_by, updated_at])
      const list = await query(ctx, `select ${COLS.excel_cells} from excel_cells where template_id = $1 and sheet_name = $2 and cell_ref = $3`,
        [input.template_id, input.sheet_name, input.cell_ref])
      return toCell(list[0]!)
    }
    const s = getStore()
    const found = s.excel_cells.find((c) => c.template_id === input.template_id && c.sheet_name === input.sheet_name && c.cell_ref === input.cell_ref)
    if (found) {
      s.excel_cells = s.excel_cells.map((c) =>
        c.id === found.id ? { ...c, value: input.value, updated_by: input.updated_by, updated_at: nowIso() } : c
      )
      bumpRevision()
      return s.excel_cells.find((c) => c.id === found.id)!
    }
    const row: ExcelCell = {
      id: newId('ec'),
      template_id: input.template_id,
      sheet_name: input.sheet_name,
      cell_ref: input.cell_ref,
      value: input.value,
      formula: '',
      updated_by: input.updated_by,
      updated_at: nowIso()
    }
    s.excel_cells = [...s.excel_cells, row]
    bumpRevision()
    return row
  }
}
