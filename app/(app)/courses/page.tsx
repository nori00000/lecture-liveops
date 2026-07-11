'use client'

import useSWR from 'swr'
import { Card, CardHeader, PageHeader } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function CoursesPage() {
  const { data } = useSWR<{ courses?: { id: string; title: string; description: string; status: string }[] }>('/api/data/sessions', fetcher)
  return (
    <div className="p-6">
      <PageHeader title="강의" desc="강의 목록" />
      <Card>
        <CardHeader title="전체 강의" hint={`${data?.courses?.length ?? 0}건`} />
        <ul className="divide-y divide-border">
          {(data?.courses ?? []).map((c) => (
            <li key={c.id} className="px-4 py-2">
              <div className="text-sm">{c.title}</div>
              <div className="text-xs text-textDim mt-0.5">{c.description}</div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
