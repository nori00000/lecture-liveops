'use client'

import useSWR from 'swr'
import { Card, CardHeader, Badge, PageHeader } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function CompaniesPage() {
  const { data } = useSWR<{ companies?: { id: string; name: string; slug: string; visibility: string }[] }>('/api/data/sessions', fetcher)
  return (
    <div className="p-6">
      <PageHeader title="기업" desc="등록된 기업 목록" />
      <Card>
        <CardHeader title="전체 기업" hint={`${data?.companies?.length ?? 0}곳`} />
        <ul className="divide-y divide-border">
          {(data?.companies ?? []).map((c) => (
            <li key={c.id} className="px-4 py-2 flex items-center gap-3">
              <span className="text-sm">{c.name}</span>
              <span className="text-xs text-textMute">{c.slug}</span>
              <Badge tone={c.visibility === 'public' ? 'accent' : 'neutral'}>{c.visibility}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
