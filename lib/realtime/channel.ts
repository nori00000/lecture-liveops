'use client'

import useSWR from 'swr'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json())

export function useSessionData<T = unknown>(
  endpoint: string,
  refreshMs = 2000,
  opts?: { onSuccess?: (data: T) => void }
) {
  return useSWR<T>(endpoint, fetcher, {
    refreshInterval: refreshMs,
    revalidateOnFocus: true,
    keepPreviousData: true,
    // 명시적 undefined는 SWR 기본 onSuccess(noop)를 덮어써 내부 TypeError →
    // 폴링이 error-retry 백오프로 변질된다. 값이 있을 때만 키를 전달한다.
    ...(opts?.onSuccess ? { onSuccess: opts.onSuccess } : {})
  })
}
