'use client'

import { Suspense, useMemo, useState, useEffect, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import { Button, Input, Textarea, Select, PageHeader } from '@/components/ui/primitives'
import { SeatMapSvg } from '@/components/seatmap/SeatMapSvg'
import type { SeatLayoutConfig } from '@/components/seatmap/types'
import { buildTshapeLayout } from '@/lib/seatmap/layout'
import { parseRosterPaste, splitMembersLoose } from '@/lib/seatmap/roster-parse'
import { SessionPicker } from '@/components/liveops/SessionPicker'

type TeamDraft = { label: string; membersText: string }

type DbPreset = {
  id: string
  slug: string
  name: string
  description: string
  layout: SeatLayoutConfig
}


const PRESETS = [
  {
    id: 'lecture-t8-332',
    label: 'T자 8팀 · 6석 (앞3 / 중간3 / 뒤2)',
    teamsCount: 8,
    perRow: 3,
    seatsPerTeam: 6
  },
  {
    id: 't5-6-32',
    label: 'T자 5팀 · 6석 (앞3 / 뒤2)',
    teamsCount: 5,
    perRow: 3,
    seatsPerTeam: 6
  },
  {
    id: 'custom',
    label: '직접 설정 (수동)',
    teamsCount: 5,
    perRow: 3,
    seatsPerTeam: 6
  }
] as const

const DEFAULT_TEAMS: TeamDraft[] = Array.from({ length: 8 }, (_, i) => ({ label: `${i + 1}팀`, membersText: '' }))

const PASTE_PLACEHOLDER = 'A-1팀\n이정현 김영환 김영우 이승민\nA-2팀\n김병각 김현종 김주영 박상민\n…'

function clampInt(v: string, lo: number, hi: number, dflt: number): number {
  const n = parseInt(v, 10)
  if (Number.isNaN(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

export default function SeatBuilderPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-textDim">불러오는 중…</div>}>
      <SeatBuilderPageInner />
    </Suspense>
  )
}

function SeatBuilderPageInner() {
  const { data } = useSessionData<{ session?: { id: string; title?: string } }>('/api/data/session')
  // ?sessionId= 가 있으면 그 세션에 저장(활성 세션을 바꾸지 않음), 없으면 활성 세션.
  const override = useSearchParams().get('sessionId')
  const targetId = override ?? data?.session?.id ?? null
  const [name, setName] = useState('T자 8팀 · 6석 (앞3 / 중간3 / 뒤2)')
  const [perRow, setPerRow] = useState(3)
  const [seatsPerTeam, setSeatsPerTeam] = useState(6)
  const [teams, setTeams] = useState<TeamDraft[]>(DEFAULT_TEAMS)
  const [presetId, setPresetId] = useState<string>('lecture-t8-332')
  const [dbPresets, setDbPresets] = useState<DbPreset[]>([])
  const [paste, setPaste] = useState('')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)

  // 컴포넌트 마운트 시 DB 프리셋 목록을 동적으로 가져옵니다.
  useEffect(() => {
    async function loadPresets() {
      try {
        const r = await invoke({
          action: 'liveops.list_seat_layout_templates',
          role: 'instructor',
          scope: {},
          input: {}
        })
        if (r && r.data && Array.isArray(r.data.list)) {
          setDbPresets(r.data.list)
        }
      } catch (e) {
        console.error('Failed to load seat layout templates:', e)
      }
    }
    loadPresets()
  }, [])

  const layout = useMemo(() => {
    const roster: Record<string, string[]> = {}
    teams.forEach((t) => {
      roster[t.label] = splitMembersLoose(t.membersText)
    })
    // 8팀 6석 3/3/2 구조일 때 rowYs 보정값을 우선 주입합니다.
    const rowYs = teams.length === 8 && seatsPerTeam === 6 && perRow === 3
      ? [26, 54, 82]
      : undefined

    return buildTshapeLayout({
      teams: Math.max(1, teams.length),
      seatsPerTeam,
      perRow,
      labelFn: (n) => teams[n - 1]?.label ?? `${n}팀`,
      roster,
      rowYs
    }) as unknown as SeatLayoutConfig
  }, [teams, seatsPerTeam, perRow])

  function handlePresetChange(id: string) {
    setPresetId(id)
    if (id === 'custom') return

    // 1. DB 프리셋에서 조회 시도
    const dbPreset = dbPresets.find((p) => p.id === id || p.slug === id)
    if (dbPreset) {
      setName(dbPreset.name)
      const tables = dbPreset.layout?.tables ?? []
      if (tables.length > 0) {
        const firstTable = tables[0]
        setSeatsPerTeam(firstTable.seats?.length ?? 6)

        // 가로축 좌표(cx) 분포 분석을 통해 perRow 대략 유추
        const uniqueXs = new Set(tables.map((t) => Math.round(t.cx)))
        setPerRow(uniqueXs.size > 0 ? Math.min(6, uniqueXs.size) : 3)

        // 기존 텍스트(이름) 보존하며 팀 크기 조정
        setTeams((cur) => {
          const nextTeams: TeamDraft[] = []
          for (let i = 0; i < tables.length; i++) {
            const tableLabel = tables[i].label ?? `${i + 1}팀`
            nextTeams.push({
              label: tableLabel,
              membersText: cur[i]?.membersText ?? ''
            })
          }
          return nextTeams
        })
      }
      return
    }

    // 2. 하드코딩된 로컬 프리셋 호환성 대응
    const localPreset = PRESETS.find((p) => p.id === id)
    if (!localPreset) return

    setPerRow(localPreset.perRow)
    setSeatsPerTeam(localPreset.seatsPerTeam)
    setName(localPreset.label)

    setTeams((cur) => {
      const nextTeams: TeamDraft[] = []
      for (let i = 0; i < localPreset.teamsCount; i++) {
        nextTeams.push({
          label: `${i + 1}팀`,
          membersText: cur[i]?.membersText ?? ''
        })
      }
      return nextTeams
    })
  }


  function applyPaste() {
    const parsed = parseRosterPaste(paste)
    if (parsed.length === 0) {
      setResult('명단을 인식하지 못했습니다. "팀 이름" 줄 + 그 아래 이름들 형식으로 붙여넣어 주세요.')
      return
    }
    setTeams(parsed.map((t) => ({ label: t.label, membersText: t.members.join(' ') })))
    setResult(`${parsed.length}개 팀 · ${parsed.reduce((s, t) => s + t.members.length, 0)}명 인식`)
    setPresetId('custom')
  }

  function updateTeam(i: number, patch: Partial<TeamDraft>) {
    setTeams((cur) => cur.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
    setPresetId('custom')
  }
  function addTeam() {
    setTeams((cur) => [...cur, { label: `${cur.length + 1}팀`, membersText: '' }])
    setPresetId('custom')
  }
  function removeTeam(i: number) {
    setTeams((cur) => cur.filter((_, idx) => idx !== i))
    setPresetId('custom')
  }

  async function save() {
    if (!targetId || busy || teams.length === 0) return
    setBusy(true)
    setResult('저장 중…')
    try {
      const hasNoRoster = teams.every((t) => !t.membersText.trim())
      const isDbPresetSelected = presetId !== 'custom' && dbPresets.some((p) => p.id === presetId || p.slug === presetId)

      let r
      if (hasNoRoster && isDbPresetSelected) {
        // 명단이 완전히 비어 있고 DB 템플릿 프리셋이 선택된 상태라면
        // 템플릿 다이렉트 적용(복사 주입) 액션을 호출합니다.
        r = await invoke({
          action: 'liveops.apply_seat_layout_template',
          role: 'instructor',
          scope: { sessionId: targetId },
          input: {
            sessionId: targetId,
            templateId: presetId,
            nameOverride: name.trim() || undefined
          }
        })
      } else {
        // 명단이 있거나 커스텀 수정된 경우에는 빌드된 layout 인스턴스를 저장합니다.
        r = await invoke({
          action: 'liveops.upsert_seat_layout',
          role: 'instructor',
          scope: { sessionId: targetId },
          input: { sessionId: targetId, name: name.trim() || '기본 배치', layout }
        })
      }

      if (r && (r.error || r.ok === false)) {
        setResult(`저장 실패: ${r.error ?? JSON.stringify(r)}`)
      } else {
        setResult(`저장됨 — ${layout.tables.length}팀. 좌석 보드에서 확인하세요.`)
      }
    } catch (e) {
      setResult(`저장 실패: ${e instanceof Error ? e.message : 'error'}`)
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className="p-6">
      <PageHeader
        title="배치도 편집"
        desc="팀을 만들고 명단을 붙여넣어 이 반의 좌석 배치도를 저장합니다."
        right={
          <div className="flex items-center gap-2 flex-wrap">
            <SessionPicker current={targetId} />
            <Link href={targetId ? `/today/seatmap?sessionId=${targetId}` : '/today/seatmap'}>
              <Button size="sm">좌석 보드로</Button>
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] gap-6 lg:gap-8">
        {/* 좌: 편집 흐름 (번호 스텝) */}
        <div className="space-y-7">
          <Step n={1} title="기본 설정 및 프리셋">
            <div className="space-y-4">
              <Field label="배치도 프리셋">
                <Select value={presetId} onChange={(e) => handlePresetChange(e.target.value)} className="w-full">
                  {/* 1. DB에서 로드해온 프리셋 목록 동적 바인딩 */}
                  {dbPresets.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} (DB)</option>
                  ))}
                  {/* 2. 로컬 프리셋 및 직접 설정 (폴백 및 하드코딩 프리셋) */}
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3 items-end sm:grid-cols-[1fr_auto_auto]">
                <Field label="배치도 이름" className="col-span-2 sm:col-span-1">
                  <Input value={name} onChange={(e) => { setName(e.target.value); setPresetId('custom') }} />
                </Field>
                <Field label="한 줄에 팀">
                  <Input type="number" min={1} max={6} value={perRow} onChange={(e) => { setPerRow(clampInt(e.target.value, 1, 6, 3)); setPresetId('custom') }} className="w-full text-center sm:w-16" />
                </Field>
                <Field label="팀당 좌석">
                  <Select value={String(seatsPerTeam)} onChange={(e) => { setSeatsPerTeam(Number(e.target.value)); setPresetId('custom') }} className="w-full">
                    {[4, 5, 6].map((n) => <option key={n} value={n}>{n}석</option>)}
                  </Select>
                </Field>
              </div>
            </div>
          </Step>


          <Step n={2} title="명단 붙여넣기" hint="팀 이름 줄 + 그 아래 이름들">
            <Textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={PASTE_PLACEHOLDER} className="leading-relaxed" />
            <div className="mt-2.5 flex items-center gap-3">
              <Button onClick={applyPaste}>명단 적용</Button>
              <span className="text-xs text-textMute">반 헤더·범례·강사 줄은 자동으로 걸러집니다.</span>
            </div>
          </Step>

          <Step
            n={3}
            title="팀"
            hint={`${teams.length}팀 · ${teams.reduce((s, t) => s + splitMembersLoose(t.membersText).length, 0)}명`}
          >
            <div className="space-y-2.5">
              {teams.map((t, i) => (
                <div key={i} className="rounded-lg border border-border bg-surface/40 p-2.5">
                  <div className="flex items-center gap-2">
                    <Input value={t.label} onChange={(e) => updateTeam(i, { label: e.target.value })} className="w-28 font-medium" aria-label={`${i + 1}번째 팀 이름`} />
                    <span className="rounded-full bg-surfaceAlt px-2 py-0.5 text-[11px] text-textDim">{splitMembersLoose(t.membersText).length}명</span>
                    <button type="button" onClick={() => removeTeam(i)} className="ml-auto text-xs text-textMute transition-colors hover:text-danger">삭제</button>
                  </div>
                  <Textarea rows={2} value={t.membersText} onChange={(e) => updateTeam(i, { membersText: e.target.value })} placeholder="이름을 띄어쓰기 또는 줄바꿈으로" aria-label={`${t.label} 명단`} className="mt-2" />
                </div>
              ))}
              <button type="button" onClick={addTeam} className="w-full rounded-lg border border-dashed border-border py-2 text-sm text-textDim transition-colors hover:border-textMute/50 hover:text-text">
                + 팀 추가
              </button>
            </div>
          </Step>
        </div>

        {/* 우: 미리보기 + 저장 (sticky) */}
        <div className="h-fit space-y-3 lg:sticky lg:top-6">
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="text-sm font-medium text-text">미리보기</span>
              <span className="text-[11px] text-textMute">{layout.tables.length}팀 · 실시간</span>
            </div>
            <div className="bg-bg/40 p-4">
              <SeatMapSvg layout={layout} marks={[]} selectedKey={null} onSelect={() => {}} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
            <Button variant="accent" onClick={save} disabled={!targetId || busy || teams.length === 0}>배치도 저장</Button>
            {!targetId ? <span className="text-xs text-textMute">세션 로딩 중</span> : null}
            {result ? <span className="text-xs text-textDim">{result}</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// 번호 배지 + 제목 + 힌트로 편집 단계를 구분한다 (동일 카드 반복 대신 리듬).
function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-medium text-textDim">{n}</span>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {hint ? <span className="text-xs text-textMute">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-[11px] uppercase tracking-wide text-textMute">{label}</span>
      {children}
    </label>
  )
}
