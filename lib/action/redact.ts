import crypto from 'node:crypto'
import type { AxRedactionPolicy } from './envelope'

export function hashInput(input: unknown): string {
  const s = typeof input === 'string' ? input : JSON.stringify(input ?? {})
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 24)
}

export function redactInput(input: unknown, policy: AxRedactionPolicy): string {
  const flat = flattenStrings(input)
  switch (policy) {
    case 'none':
      // 'none'은 admin + dry-run 게이트에서만 호출되어야 한다. 그래도 summary로 안전 처리.
      return truncate(flat.join(' | '), 200)
    case 'summary': {
      const first = flat[0] ?? ''
      return truncate(maskPrivatePatterns(first), 160)
    }
    case 'mask-private':
      return truncate(flat.map(maskPrivatePatterns).join(' | '), 160)
    case 'metadata-only':
    default: {
      const fields = collectKeys(input)
      return truncate(`[metadata-only] fields=${fields.join(',')}`, 160)
    }
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function flattenStrings(v: unknown, acc: string[] = []): string[] {
  if (v == null) return acc
  if (typeof v === 'string') {
    acc.push(v)
    return acc
  }
  if (Array.isArray(v)) {
    for (const x of v) flattenStrings(x, acc)
    return acc
  }
  if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) flattenStrings(x, acc)
    return acc
  }
  return acc
}

function collectKeys(v: unknown, depth = 0): string[] {
  if (depth > 3) return []
  if (v == null || typeof v !== 'object') return []
  if (Array.isArray(v)) return v.flatMap((x) => collectKeys(x, depth + 1))
  return Object.keys(v as Record<string, unknown>)
}

const SECRET_PATTERNS: { re: RegExp; replace: string }[] = [
  { re: /Bearer\s+[A-Za-z0-9._-]+/g, replace: '[REDACTED_BEARER]' },
  { re: /sk-[A-Za-z0-9-]{16,}/g, replace: '[REDACTED_OPENAI]' },
  { re: /eyJ[A-Za-z0-9_.-]{20,}/g, replace: '[REDACTED_JWT]' },
  { re: /gho_[A-Za-z0-9]{20,}/g, replace: '[REDACTED_GH]' },
  { re: /\b\d{2,3}-\d{3,4}-\d{4}\b/g, replace: '[REDACTED_PHONE]' },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replace: '[REDACTED_EMAIL]' }
]

export function maskPrivatePatterns(s: string): string {
  let out = s
  for (const { re, replace } of SECRET_PATTERNS) out = out.replace(re, replace)
  return out
}
