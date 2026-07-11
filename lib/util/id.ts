export function newId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${ts}${rand}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
