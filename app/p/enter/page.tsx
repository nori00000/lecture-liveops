'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api/fetcher'
import { Button, Card, Input } from '@/components/ui/primitives'

export default function ParticipantEnterPage() {
  const router = useRouter()
  const [accessKey, setAccessKey] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    const res = await apiFetch('/api/p/enter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accessKey })
    })
    const body = await res.json() as { ok?: boolean; redirectTo?: string; error?: string }
    setSubmitting(false)
    if (!res.ok || !body.ok) {
      setError(body.error ?? '접속 키를 확인해 주세요.')
      return
    }
    router.replace(body.redirectTo ?? '/p/dashboard')
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
      <Card className="max-w-md w-full p-6">
        <div className="mb-5">
          <div className="text-xl font-semibold mb-2">참가자 접속</div>
          <p className="text-sm text-textDim">강의 운영자가 공유한 access key를 한 번만 입력하면 이후에는 URL에 키가 남지 않습니다.</p>
        </div>
        <form className="space-y-3" onSubmit={submit}>
          <Input value={accessKey} onChange={(event) => setAccessKey(event.target.value)} placeholder="Access key" autoFocus />
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          <Button className="w-full justify-center" variant="accent" disabled={submitting || !accessKey.trim()}>
            {submitting ? '확인 중' : '입장하기'}
          </Button>
        </form>
      </Card>
    </main>
  )
}
