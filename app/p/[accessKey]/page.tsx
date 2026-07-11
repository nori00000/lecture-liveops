'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api/fetcher'
import { Button, Card } from '@/components/ui/primitives'

export default function ParticipantAccessKeyPage({ params }: { params: Promise<{ accessKey: string }> }) {
  const { accessKey } = use(params)
  const router = useRouter()
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function exchangeKey() {
      const res = await apiFetch('/api/p/enter', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ accessKey })
      })
      const body = await res.json() as { ok?: boolean; redirectTo?: string; error?: string }
      if (cancelled) return
      if (!res.ok || !body.ok) {
        setError(body.error ?? '접속 키를 확인해 주세요.')
        return
      }
      router.replace(body.redirectTo ?? '/p/dashboard')
    }
    exchangeKey()
    return () => {
      cancelled = true
    }
  }, [accessKey, router])

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <Card className="max-w-md w-full p-6 text-center">
        <div className="text-xl font-semibold mb-2">참가자 세션으로 전환 중</div>
        <p className="text-sm text-textDim mb-4">URL에 남은 access key를 httpOnly 세션 cookie로 교체하고 있습니다.</p>
        {error ? (
          <>
            <p className="text-sm text-danger mb-4">{error}</p>
            <Button variant="accent" onClick={() => router.replace('/p/enter')}>접속 키 다시 입력</Button>
          </>
        ) : null}
      </Card>
    </main>
  )
}
