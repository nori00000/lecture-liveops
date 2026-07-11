// Lecture LiveOps — client fetcher (P1-3)
// mutating method 요청에 CSRF 토큰을 자동으로 헤더에 부착하고 cookie를 동봉한다.
// SWR / action launcher / offline queue 등 모든 클라이언트 호출이 이 함수를 통해야 한다.

import { CSRF_HEADER } from '../csrf'

let cachedToken: string | null = null
let pending: Promise<string> | null = null

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch('/api/csrf', { credentials: 'same-origin', cache: 'no-store' })
  if (!res.ok) throw new Error('csrf token fetch failed: ' + res.status)
  const body = (await res.json()) as { token?: string }
  if (!body.token) throw new Error('csrf token response missing token')
  return body.token
}

export async function getCsrfToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken) return cachedToken
  if (pending) return pending
  pending = fetchCsrfToken()
    .then((t) => {
      cachedToken = t
      pending = null
      return t
    })
    .catch((e) => {
      pending = null
      throw e
    })
  return pending
}

export function resetCsrfTokenForTest(): void {
  cachedToken = null
  pending = null
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers = new Headers(init.headers ?? {})
  if (MUTATING.has(method)) {
    const token = await getCsrfToken()
    headers.set(CSRF_HEADER, token)
  }
  const res = await fetch(input, { ...init, headers, credentials: 'same-origin' })
  // 토큰 invalid 시 (예: 만료) 한 번 더 재발급 후 재시도
  if (MUTATING.has(method) && res.status === 403) {
    try {
      const body = await res.clone().json()
      if (body?.error === 'csrf_invalid') {
        const token = await getCsrfToken(true)
        const retryHeaders = new Headers(init.headers ?? {})
        retryHeaders.set(CSRF_HEADER, token)
        return fetch(input, { ...init, headers: retryHeaders, credentials: 'same-origin' })
      }
    } catch {
      // body parse 실패 시 원래 응답 반환
    }
  }
  return res
}

// SWR fetcher (GET 전용)
export const swrFetcher = (url: string) => apiFetch(url, { cache: 'no-store' }).then((r) => r.json())
