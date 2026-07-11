'use client'

import useSWR from 'swr'
import { Card, CardHeader, Badge, PageHeader } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function DatesPage() {
  type SItem = { id: string; title: string; date: string; mode: string }
  const { data } = useSWR<{ sessions?: SItem[] }>('/api/data/sessions', fetcher)
  const byDate = (data?.sessions ?? []).reduce<Record<string, SItem[]>>((acc, s) => {
    acc[s.date] = acc[s.date] ?? []
    acc[s.date].push(s)
    return acc
  }, {})
  return (
    <div className="p-6">
      <PageHeader title="날짜" desc="날짜별 세션" />
      <div className="space-y-3">
        {Object.entries(byDate).sort().map(([d, items]) => (
          <Card key={d}>
            <CardHeader title={d} hint={`${items!.length}건`} />
            <ul className="divide-y divide-border">
              {items!.map((s) => (
                <li key={s.id} className="px-4 py-2 flex items-center gap-3">
                  <Badge tone={s.mode === 'live' ? 'accent' : 'neutral'}>{s.mode}</Badge>
                  <span className="text-sm">{s.title}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
