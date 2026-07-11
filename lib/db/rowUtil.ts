// row util 분리 — neonHelpers에서 re-export
export type Row = Record<string, unknown>

export function normalizeRow<T extends Row>(row: Row): T {
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString()
    else out[k] = v
  }
  return out as T
}

export function normalizeRows<T extends Row>(rows: Row[]): T[] {
  return rows.map((r) => normalizeRow<T>(r))
}
