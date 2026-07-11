import { afterEach, describe, expect, it } from 'vitest'
import {
  constantTimeEquals,
  isOperatorGateEnabled,
  isOperatorProtectedPath,
  verifyOperatorCookie
} from '@/lib/security/operatorGate'

const ORIGINAL = process.env.LIVEOPS_OPERATOR_KEY

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.LIVEOPS_OPERATOR_KEY
  else process.env.LIVEOPS_OPERATOR_KEY = ORIGINAL
})

describe('operator gate', () => {
  it('constantTimeEquals — 일치/불일치/빈값/길이차', () => {
    expect(constantTimeEquals('abc123', 'abc123')).toBe(true)
    expect(constantTimeEquals('abc123', 'abc124')).toBe(false)
    expect(constantTimeEquals('', '')).toBe(true)
    expect(constantTimeEquals('a', '')).toBe(false)
    expect(constantTimeEquals('short', 'muchlongerkey')).toBe(false)
  })

  it('env 없으면 개발에서 비활성 + 쿠키 통과', () => {
    delete process.env.LIVEOPS_OPERATOR_KEY
    expect(isOperatorGateEnabled()).toBe(false)
    expect(verifyOperatorCookie(undefined)).toBe(true)
    expect(verifyOperatorCookie('anything')).toBe(true)
  })

  it('env 있으면 정확한 쿠키만 통과', () => {
    process.env.LIVEOPS_OPERATOR_KEY = 'k-test-1'
    expect(isOperatorGateEnabled()).toBe(true)
    expect(verifyOperatorCookie('k-test-1')).toBe(true)
    expect(verifyOperatorCookie('k-test-2')).toBe(false)
    expect(verifyOperatorCookie(undefined)).toBe(false)
    expect(verifyOperatorCookie('')).toBe(false)
  })

  it('보호 경로 판정 — 보호/면제', () => {
    for (const p of ['/today', '/today/seatmap', '/api/data/session', '/api/data/seatmap', '/api/timeline-sync', '/companies', '/settings']) {
      expect(isOperatorProtectedPath(p), p).toBe(true)
    }
    for (const p of ['/api/data/participant/session', '/enter', '/api/enter', '/p/key1', '/api/p/enter', '/share/tok', '/api/public/share/tok', '/api/health', '/admin/login', '/']) {
      expect(isOperatorProtectedPath(p), p).toBe(false)
    }
  })
})
