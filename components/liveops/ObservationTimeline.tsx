'use client'

import { useRef, useState } from 'react'
import { Badge, Button, Card, CardHeader } from '@/components/ui/primitives'
import type { StructuredObservation } from '@/lib/liveops/types'
import { formatTimeKo } from '@/lib/util/koreanTime'
import { filesToResizedDataUrls, resizeFiles, extractImageFiles } from '@/lib/util/image'

const CATEGORY_LABEL: Record<string, string> = {
  mood: '분위기',
  question: '질문',
  answer: '답변',
  error: '오류',
  cause: '원인',
  solution: '해결',
  lecture_speed: '속도',
  material: '자료',
  action: '조치',
  followup: '후속',
  progress: '진행',
  signal: '신호'
}

const AUDIENCE_LABEL: Record<string, string> = {
  main: '메인강사',
  assistant: '보조강사',
  both: '메인·보조'
}

// 심각도 한국어 라벨 — 영어(low/medium/high/urgent) 혼용 제거. 색은 toneForSeverity가 담당.
const SEVERITY_LABEL: Record<string, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  urgent: '긴급'
}

export type ObservationPatch = { summary: string; question?: string; answer?: string; issue?: string; solution?: string; images?: string[] }

const MAX_IMAGES = 8

// 페이지 번호 윈도우 — 페이지가 많으면 [0 … cur-1 cur cur+1 … last], -1은 생략(…) 표시.
function pageWindow(cur: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i)
  const out: number[] = [0]
  const lo = Math.max(1, cur - 1), hi = Math.min(total - 2, cur + 1)
  if (lo > 1) out.push(-1)
  for (let i = lo; i <= hi; i++) out.push(i)
  if (hi < total - 2) out.push(-1)
  out.push(total - 1)
  return out
}

export function ObservationTimeline({
  observations,
  onDelete,
  onUpdate
}: {
  observations: StructuredObservation[]
  onDelete?: (id: string) => void
  onUpdate?: (id: string, patch: ObservationPatch) => void
}) {
  const [editId, setEditId] = useState<string | null>(null)
  const [draftSummary, setDraftSummary] = useState('')
  const [draftQ, setDraftQ] = useState('')
  const [draftA, setDraftA] = useState('')
  const [draftIssue, setDraftIssue] = useState('')
  const [draftSol, setDraftSol] = useState('')
  const [draftImages, setDraftImages] = useState<string[]>([])
  const editFileRef = useRef<HTMLInputElement>(null)
  const attachFileRef = useRef<HTMLInputElement>(null)
  const attachForRef = useRef<string | null>(null)
  const [dragRow, setDragRow] = useState<string | null>(null)
  // 라이브 중 "지금 안 풀린 것"만 빠르게 보기 위한 필터.
  const [unresolvedOnly, setUnresolvedOnly] = useState(false)
  const [catFilter, setCatFilter] = useState<string>('all')
  const [sevFilter, setSevFilter] = useState<string>('all')
  const [page, setPage] = useState(0)

  const catsPresent = Array.from(new Set(observations.map((o) => o.category)))
  const filtered = observations.filter((o) => {
    if (unresolvedOnly && (o.resolved || o.category === 'solution')) return false
    if (catFilter !== 'all' && o.category !== catFilter) return false
    if (sevFilter !== 'all' && o.severity !== sevFilter) return false
    return true
  })
  // 페이지네이션 — 로그가 많아지면 페이지로 나눠 ◀ 1 2 … ▶ 로 넘긴다.
  const perPage = 20
  const pageCount = Math.max(1, Math.ceil(filtered.length / perPage))
  const safePage = Math.min(page, pageCount - 1)
  const shown = filtered.slice(safePage * perPage, safePage * perPage + perPage)
  const selectClass = 'text-xs rounded border border-border bg-bg px-2 py-1 text-textDim'

  // 수정 폼을 열지 않고 행에 직접 이미지를 첨부한다(기존 이미지에 이어붙임).
  async function attachImages(o: StructuredObservation, files: File[]) {
    if (!onUpdate || !files.length) return
    const added = await resizeFiles(files, MAX_IMAGES)
    if (!added.length) return
    const merged = [...parseImages(o.image_data), ...added].slice(0, MAX_IMAGES)
    onUpdate(o.id, {
      summary: o.summary,
      question: o.question,
      answer: o.answer,
      issue: o.issue,
      solution: o.solution,
      images: merged
    })
  }

  const startEdit = (o: StructuredObservation) => {
    setEditId(o.id)
    setDraftSummary(o.summary)
    setDraftQ(o.question ?? '')
    setDraftA(o.answer ?? '')
    setDraftIssue(o.issue ?? '')
    setDraftSol(o.solution ?? '')
    setDraftImages(parseImages(o.image_data))
  }

  async function addEditImages(files: FileList | null) {
    const added = await filesToResizedDataUrls(files, MAX_IMAGES)
    if (added.length) setDraftImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES))
  }

  // 드롭/붙여넣기 → 이미지 추출(items fallback 포함) 후 수정 폼 이미지에 추가.
  async function addEditFromTransfer(dt: DataTransfer | null) {
    const added = await resizeFiles(extractImageFiles(dt), MAX_IMAGES)
    if (added.length) setDraftImages((prev) => [...prev, ...added].slice(0, MAX_IMAGES))
  }

  const save = () => {
    if (!editId) return
    onUpdate?.(editId, {
      summary: draftSummary.trim() || '(내용)',
      question: draftQ.trim() || undefined,
      answer: draftA.trim() || undefined,
      issue: draftIssue.trim() || undefined,
      solution: draftSol.trim() || undefined,
      images: draftImages
    })
    setEditId(null)
  }

  const fieldClass = 'w-full text-sm rounded border border-border bg-bg p-2 text-text'

  return (
    <Card>
      <CardHeader title="최근 관찰 로그" hint="시간순 · ✎ 수정 · 이미지 첨부" />
      <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setUnresolvedOnly((v) => !v); setPage(0) }}
          aria-pressed={unresolvedOnly}
          className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${unresolvedOnly ? 'bg-danger/15 text-danger border-danger/40' : 'bg-surfaceAlt/60 text-textDim border-border hover:text-text'}`}
        >
          미해결만
        </button>
        <select aria-label="분류 필터" value={catFilter} onChange={(e) => { setCatFilter(e.target.value); setPage(0) }} className={selectClass}>
          <option value="all">전체 분류</option>
          {catsPresent.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABEL[c] ?? c}</option>
          ))}
        </select>
        <select aria-label="심각도 필터" value={sevFilter} onChange={(e) => { setSevFilter(e.target.value); setPage(0) }} className={selectClass}>
          <option value="all">전체 심각도</option>
          <option value="urgent">긴급</option>
          <option value="high">높음</option>
          <option value="medium">보통</option>
          <option value="low">낮음</option>
        </select>
        <span className="text-xs text-textMute ml-auto" role="status" aria-live="polite">
          {filtered.length}건{pageCount > 1 ? ` · ${safePage + 1}/${pageCount}쪽` : ''}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {shown.map((o) => {
          if (editId === o.id) {
            return (
              <li
                key={o.id}
                className="px-4 py-3 space-y-2"
                onDrop={(e) => {
                  e.preventDefault()
                  void addEditFromTransfer(e.dataTransfer)
                }}
                onDragOver={(e) => e.preventDefault()}
                onPaste={(e) => {
                  const files = extractImageFiles(e.clipboardData)
                  if (files.length) {
                    e.preventDefault()
                    void addEditFromTransfer(e.clipboardData)
                  }
                }}
              >
                <textarea value={draftSummary} onChange={(e) => setDraftSummary(e.target.value)} rows={3} className={fieldClass} placeholder="내용(원문) · 이미지 드래그·붙여넣기 가능" />
                <input value={draftQ} onChange={(e) => setDraftQ(e.target.value)} className={fieldClass} placeholder="질문 (선택)" />
                <input value={draftA} onChange={(e) => setDraftA(e.target.value)} className={fieldClass} placeholder="답변 (선택)" />
                <input value={draftIssue} onChange={(e) => setDraftIssue(e.target.value)} className={fieldClass} placeholder="오류 (선택)" />
                <input value={draftSol} onChange={(e) => setDraftSol(e.target.value)} className={fieldClass} placeholder="해결 (선택)" />
                {draftImages.length ? (
                  <div className="flex flex-wrap gap-2">
                    {draftImages.map((img, i) => (
                      <div key={i} className="relative inline-block">
                        <img src={img} alt={`첨부 ${i + 1}`} className="max-h-24 rounded border border-border" />
                        <button
                          type="button"
                          onClick={() => setDraftImages((prev) => prev.filter((_, idx) => idx !== i))}
                          aria-label={`이미지 ${i + 1} 제거`}
                          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-danger/80 text-white text-xs flex items-center justify-center"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2 items-center">
                  <Button variant="accent" onClick={save}>저장</Button>
                  <Button onClick={() => setEditId(null)}>취소</Button>
                  <Button onClick={() => editFileRef.current?.click()} disabled={draftImages.length >= MAX_IMAGES}>
                    {draftImages.length ? `이미지 +(${draftImages.length}/${MAX_IMAGES})` : '이미지 추가'}
                  </Button>
                </div>
                <input
                  ref={editFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void addEditImages(e.target.files)
                    e.target.value = ''
                  }}
                />
              </li>
            )
          }
          const canAttach = !!onUpdate && o.id.startsWith('ob-')
          return (
            <li
              key={o.id}
              className={`px-4 py-3 flex gap-3 items-start transition-colors ${dragRow === o.id ? 'bg-accent/5 ring-1 ring-inset ring-accent/40' : ''}`}
              onDrop={canAttach ? (e) => { e.preventDefault(); setDragRow(null); void attachImages(o, extractImageFiles(e.dataTransfer)) } : undefined}
              onDragOver={canAttach ? (e) => { e.preventDefault(); setDragRow(o.id) } : undefined}
              onDragLeave={canAttach ? () => setDragRow(null) : undefined}
              onPaste={canAttach ? (e) => { const f = extractImageFiles(e.clipboardData); if (f.length) { e.preventDefault(); void attachImages(o, f) } } : undefined}
            >
              <span className="text-xs text-textMute w-14 shrink-0">{o.time_label ?? formatTimeKo(o.created_at)}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {o.raw_note_id?.startsWith('transcript') ? <Badge tone="accent">transcript</Badge> : null}
                  {o.resolved ? <ResolvedBadge /> : null}
                  <Badge tone={toneForCategory(o.category)}>{CATEGORY_LABEL[o.category] ?? o.category}</Badge>
                  {o.target ? <Badge tone="info">{o.target}</Badge> : null}
                  {o.audience ? <Badge tone="accent">{AUDIENCE_LABEL[o.audience] ?? o.audience}</Badge> : null}
                  {o.resolved ? null : <Badge tone={toneForSeverity(o.severity)}>{SEVERITY_LABEL[o.severity] ?? o.severity}</Badge>}
                </div>
                <div className={o.resolved ? 'line-through decoration-textMute/70 text-textMute' : 'text-text'}>
                  {o.question && o.answer ? (
                    <div className="space-y-1">
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words">
                        <span className="text-textMute font-semibold">Q. </span>{o.question}
                      </p>
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words">
                        <span className="text-accent font-semibold">A. </span>{o.answer}
                      </p>
                    </div>
                  ) : o.issue && o.solution ? (
                    <div className="space-y-1">
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words">
                        <span className="text-danger font-semibold">오류. </span>{o.issue}
                      </p>
                      <p className="text-sm leading-6 whitespace-pre-wrap break-words">
                        <span className="text-accent font-semibold">해결. </span>{o.solution}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm leading-6 whitespace-pre-wrap break-words">{o.summary}</p>
                  )}
                </div>
                {parseImages(o.image_data).length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {parseImages(o.image_data).map((src, i) => (
                      <a key={i} href={src} target="_blank" rel="noreferrer" className="inline-block">
                        <img src={src} alt={`스크린샷 ${i + 1}`} className="max-h-28 rounded border border-border" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </div>
              {canAttach ? (
                <AttachButton
                  onClick={() => {
                    attachForRef.current = o.id
                    attachFileRef.current?.click()
                  }}
                />
              ) : null}
              {onUpdate ? <EditButton onClick={() => startEdit(o)} /> : null}
              {onDelete ? (
                <DeleteButton
                  onClick={() => {
                    if (window.confirm('이 관찰 로그를 삭제할까요?')) onDelete(o.id)
                  }}
                />
              ) : null}
            </li>
          )
        })}
        {!filtered.length ? (
          <li className="px-4 py-6 text-sm text-textMute">
            {observations.length ? '조건에 맞는 로그가 없습니다. 필터를 바꿔 보세요.' : '아직 관찰 로그가 없습니다.'}
          </li>
        ) : null}
      </ul>
      {pageCount > 1 ? (
        <nav className="flex items-center justify-center gap-1 py-2.5 border-t border-border" aria-label="관찰 로그 페이지">
          <button type="button" onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
            aria-label="이전 페이지" className="px-2 py-1 rounded text-sm text-textDim hover:text-text disabled:opacity-30 disabled:hover:text-textDim">◀</button>
          {pageWindow(safePage, pageCount).map((p, i) =>
            p === -1 ? (
              <span key={`gap${i}`} className="px-1 text-textMute select-none">…</span>
            ) : (
              <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === safePage ? 'page' : undefined}
                className={`min-w-[1.9rem] px-2 py-1 rounded text-sm transition-colors ${p === safePage ? 'bg-accent/15 text-text font-medium' : 'text-textDim hover:text-text hover:bg-surfaceAlt'}`}>{p + 1}</button>
            )
          )}
          <button type="button" onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))} disabled={safePage === pageCount - 1}
            aria-label="다음 페이지" className="px-2 py-1 rounded text-sm text-textDim hover:text-text disabled:opacity-30 disabled:hover:text-textDim">▶</button>
        </nav>
      ) : null}
      <input
        ref={attachFileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const ob = observations.find((x) => x.id === attachForRef.current)
          const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'))
          if (ob) void attachImages(ob, files)
          e.target.value = ''
        }}
      />
    </Card>
  )
}

// 해결완료 배지 — 연한 초록. 'solution' 카테고리의 '해결'(진한 accent) content 배지와 의도적으로 구분한다.
function ResolvedBadge() {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] rounded border bg-accent/5 text-accent/70 border-accent/25">
      해결완료
    </span>
  )
}

function AttachButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="이미지 첨부"
      title="이미지 첨부 (드래그·붙여넣기도 가능)"
      onClick={onClick}
      className="shrink-0 mt-1 w-8 h-8 rounded border border-border bg-surfaceAlt/70 text-textMute hover:text-text hover:bg-border transition-colors flex items-center justify-center"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="w-4 h-4">
        <rect x="2.3" y="3.3" width="11.4" height="9.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="5.8" cy="6.4" r="1.05" fill="currentColor" />
        <path d="M3 11.7 L6.6 8 L9 10.4 L11 8.6 L13 10.8" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="수정"
      onClick={onClick}
      className="shrink-0 mt-1 w-8 h-8 rounded border border-border bg-surfaceAlt/70 text-textMute hover:text-text hover:bg-border transition-colors flex items-center justify-center"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="w-4 h-4">
        <path d="M 10.5 2.5 L 13.5 5.5 L 6 13 L 3 13 L 3 10 Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    </button>
  )
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="관찰 로그 삭제"
      onClick={onClick}
      className="shrink-0 mt-1 w-8 h-8 rounded border border-danger/40 bg-danger/5 text-danger/70 hover:bg-danger/15 hover:text-danger transition-colors flex items-center justify-center"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" className="w-4 h-4">
        <path
          d="M 3.5 4 L 12.5 4 M 6.5 4 L 6.5 2.8 L 9.5 2.8 L 9.5 4 M 5 4 L 5.5 13 L 10.5 13 L 11 4 M 6.8 6.5 L 7 11 M 9.2 6.5 L 9 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}

// image_data 파싱 — 다중은 JSON 배열, 단일(레거시)은 'data:...' 문자열. 둘 다 string[]로 반환.
function parseImages(v?: string): string[] {
  if (!v) return []
  if (v.startsWith('[')) {
    try {
      const a: unknown = JSON.parse(v)
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return [v]
}

function toneForCategory(category: StructuredObservation['category']) {
  if (category === 'error') return 'danger' as const
  if (category === 'solution') return 'accent' as const
  if (category === 'question') return 'warn' as const
  if (category === 'mood') return 'info' as const
  return 'neutral' as const
}

function toneForSeverity(severity: StructuredObservation['severity']) {
  if (severity === 'urgent') return 'danger' as const
  if (severity === 'high') return 'warn' as const
  if (severity === 'medium') return 'info' as const
  return 'neutral' as const
}
