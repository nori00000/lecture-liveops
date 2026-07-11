'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Card, CardHeader, Badge, Button, PageHeader, Input } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function ArchivePage() {
  const { data } = useSWR<{ sessions?: { id: string; title: string; date: string; mode: string; company_id: string }[]; companies?: { id: string; name: string }[]; courses?: { id: string; title: string }[] }>('/api/data/sessions', fetcher)
  const sessions = data?.sessions ?? []
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const filtered = q
    ? sessions.filter((s) => {
        const company = data?.companies?.find((c) => c.id === s.company_id)?.name ?? ''
        return (
          s.title.toLowerCase().includes(q) ||
          company.toLowerCase().includes(q) ||
          s.date.toLowerCase().includes(q)
        )
      })
    : sessions
  return (
    <div className="p-6">
      <PageHeader title="아카이브" desc="지난 세션 검색 · 타임라인 조회 · Markdown 백업" />
      <div className="mb-4 max-w-sm">
        <Input
          type="search"
          aria-label="세션 검색 (제목, 회사명, 날짜)"
          placeholder="제목 · 회사명 · 날짜로 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <Card>
        <CardHeader title="모든 세션" hint={`${filtered.length}건`} />
        {filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-textMute">검색 결과 없음</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((s) => {
              const company = data?.companies?.find((c) => c.id === s.company_id)?.name ?? ''
              return (
                <li key={s.id} className="px-4 py-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Badge tone={s.mode === 'live' ? 'accent' : s.mode === 'archived' ? 'neutral' : 'info'}>{s.mode}</Badge>
                    <Link href={`/sessions/${s.id}`} className="text-sm hover:text-accent truncate">{s.title}</Link>
                  </div>
                  <span className="text-xs text-textMute md:ml-auto">{company} · {s.date}</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Link href={`/sessions/${s.id}/timeline`}><Button size="sm">타임라인</Button></Link>
                    <Link href={`/sessions/${s.id}/export`}><Button size="sm" variant="accent">MD Export</Button></Link>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
