'use client'

import { useState } from 'react'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Button, PageHeader, Select } from '@/components/ui/primitives'

const PROFILES = ['internal_retro', 'company_deliverable', 'participant_share', 'markdown_archive'] as const
const FORMATS = ['md', 'xlsx', 'pdf', 'html'] as const

// 표시 라벨만 한글화 — 실제 전송 값/enum 키(internal_retro 등)는 그대로 유지(백엔드 호환).
const PROFILE_LABELS: Record<string, string> = {
  internal_retro: '내부 회고',
  company_deliverable: '기업 제출용',
  participant_share: '참가자 공유',
  markdown_archive: 'Markdown 보관본'
}

type ExportJobLite = {
  id: string
  profile: string
  formats: string[]
  status: string
  output_paths?: { backup?: boolean; kind?: string; counts?: Record<string, number> }
  created_at: string
}

export default function ExportPage() {
  const { data, mutate } = useSessionData<{ session?: { id: string }; export_jobs?: ExportJobLite[] }>('/api/data/session')
  const session = data?.session
  const [profile, setProfile] = useState<typeof PROFILES[number]>('internal_retro')
  const [selected, setSelected] = useState<string[]>(['md'])
  const [obsResult, setObsResult] = useState<string>('')
  const [htmlBusy, setHtmlBusy] = useState(false)

  function toggle(f: string) {
    setSelected((cur) => (cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]))
  }

  async function runExport(backup = false) {
    if (!session) return
    const r = await invoke({
      action: 'liveops.export_session_archive',
      role: 'instructor',
      scope: { sessionId: session.id },
      input: { sessionId: session.id, profile, formats: selected, backup },
      dryRun: false
    })
    setObsResult(JSON.stringify(r, null, 2))
    mutate()
  }

  async function runArchivePreview() {
    if (!session) return
    const r = await invoke({
      action: 'liveops.preview_archive_target',
      role: 'instructor',
      scope: { sessionId: session.id },
      input: { sessionId: session.id, profile: 'markdown_archive' },
      // 핸들러 자체가 dry-run(실쓰기 없음) — envelope dryRun=true는 route short-circuit으로
      // 핸들러가 호출되지 않아 결과(target/files)가 비어버림. 그래서 false로 보낸다.
      dryRun: false
    })
    setObsResult(JSON.stringify(r, null, 2))
    mutate()
  }

  // 세션 아카이브를 LLM 기반 단일 HTML 문서로 생성해 다운로드 (실패 시 결정론 fallback). 모델명은 내부용으로만 유지.
  async function downloadHtml() {
    if (!session || htmlBusy) return
    setHtmlBusy(true)
    setObsResult('HTML 관찰일지 생성 중... (최대 1분 소요)')
    try {
      const res = await fetch(`/api/export/html?sessionId=${encodeURIComponent(session.id)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const engine = res.headers.get('x-export-engine') ?? '?'
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      const cd = res.headers.get('content-disposition') ?? ''
      const m = cd.match(/filename\*=UTF-8''(.+)$/)
      a.download = m ? decodeURIComponent(m[1]) : 'session.html'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      setObsResult(`HTML 다운로드 완료 (생성 방식: ${engine !== 'fallback' ? `AI 생성 · ${engine}` : '기본 서식'})`)
    } catch (e) {
      setObsResult(`HTML 생성 실패: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setHtmlBusy(false)
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="내보내기" desc="세션 백업 · Markdown · 외부 보관 미리보기(쓰기 없음)" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="내보내기 실행" />
          <div className="p-4 space-y-3">
            <div>
              <div className="text-xs text-textDim mb-1">프로파일</div>
              <Select value={profile} onChange={(e) => setProfile(e.target.value as typeof PROFILES[number])}>
                {PROFILES.map((p) => <option key={p} value={p}>{PROFILE_LABELS[p]}</option>)}
              </Select>
            </div>
            <div>
              <div className="text-xs text-textDim mb-1">포맷</div>
              <div className="flex gap-2 flex-wrap">
                {FORMATS.map((f) => (
                  <label key={f} className="inline-flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={selected.includes(f)} onChange={() => toggle(f)} />
                    {f}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Button variant="accent" onClick={() => runExport(false)} disabled={!session}>내보내기 실행</Button>
              <Button onClick={() => runExport(true)} disabled={!session}>세션 백업 저장</Button>
              <Button onClick={runArchivePreview} disabled={!session}>외부 보관 미리보기</Button>
              <Button variant="accent" onClick={downloadHtml} disabled={!session || htmlBusy}>
                {htmlBusy ? 'HTML 생성 중…' : 'HTML 생성·다운로드'}
              </Button>
              {!session ? <span className="text-xs text-textMute">세션 로딩 중</span> : null}
            </div>
            <p className="text-xs text-textMute leading-relaxed">
              세션 백업은 내보내기 기록에 시각·파일 목록·건수를 스냅샷으로 남깁니다. 외부 보관 대상에 실제 파일 쓰기는 사용자가 직접 적용을 승인한 뒤에만 진행합니다.
            </p>
          </div>
        </Card>
        <Card>
          <CardHeader title="결과 미리보기" />
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-textDim min-h-[200px]">{obsResult || '아직 실행 전'}</pre>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="최근 내보내기/백업" hint={`${data?.export_jobs?.length ?? 0}건`} />
        <ul className="divide-y divide-border">
          {(data?.export_jobs ?? []).slice().reverse().map((j) => (
            <li key={j.id} className="px-4 py-2 text-sm flex gap-3 items-center">
              <span className="text-xs text-textMute w-32 shrink-0">{j.created_at.slice(0, 16).replace('T', ' ')}</span>
              <span>{j.output_paths?.backup ? '백업' : (PROFILE_LABELS[j.profile] ?? j.profile)}</span>
              <span className="text-textDim">{j.formats.join(', ')}</span>
              {j.output_paths?.counts ? <span className="text-xs text-textMute">항목 {sumCounts(j.output_paths.counts)}건</span> : null}
              <span className="ml-auto text-textDim">{j.status}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function sumCounts(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0)
}
