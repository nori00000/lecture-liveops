'use client'

import useSWR from 'swr'
import { Card, CardHeader, PageHeader, Badge } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function SettingsPage() {
  const { data: health } = useSWR<{ mode: string; service: string }>('/api/health', fetcher)
  const { data: cat } = useSWR<{ catalog: string[] }>('/api/action', fetcher)
  return (
    <div className="p-6">
      <PageHeader title="설정" desc="환경 모드와 등록된 action contract 확인" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="환경" />
          <div className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-textDim w-28">데이터 모드</span>
              <Badge tone={health?.mode === 'supabase' ? 'accent' : 'warn'}>{health?.mode ?? '...'}</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-textDim w-28">서비스</span>
              <span>{health?.service ?? 'ax-liveops'}</span>
            </div>
            <p className="text-xs text-textMute pt-2 leading-relaxed">
              .env.example을 복사하고 Supabase 키를 채우면 실제 인스턴스 모드로 전환됩니다. 실제 push/migration은 사용자 승인 후.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="등록 action" hint={`${cat?.catalog?.length ?? 0}개`} />
          <ul className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs font-mono">
            {(cat?.catalog ?? []).map((a) => <li key={a} className="px-2 py-1 bg-surfaceAlt rounded">{a}</li>)}
          </ul>
        </Card>
      </div>
    </div>
  )
}
