'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useSessionData } from '@/lib/realtime/channel'
import { BOARD_COOKIE } from '@/lib/liveops/board-cookie'

type SessionLite = { id: string; title: string; date?: string; mode?: string; company_id?: string }

// 세션(분반) 전환기 — 활성 세션 대신 고른 세션을 대상으로 동작하게 한다.
// 커스텀 드롭다운: 상태 dot + 제목 + 날짜/상태, 선택 항목은 accent 틴트+체크로 표시(세로줄 금지).
export function SessionPicker({ current }: { current: string | null }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data } = useSessionData<{ sessions?: SessionLite[] }>('/api/data/sessions')
  const all = data?.sessions ?? []
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // 이번 교육의 분반만 노출 = 현재 세션과 같은 날짜 + 같은 기업 (없으면 전체).
  const cur = all.find((s) => s.id === current) ?? null
  const sessions = cur ? all.filter((s) => s.date === cur.date && s.company_id === cur.company_id) : all
  if (sessions.length < 2) return null

  function pick(id: string) {
    setOpen(false)
    // 쿠키에 저장 → 다른 메뉴로 이동하거나 새로고침해도 이 분반이 유지된다(A반 리셋 방지).
    document.cookie = `${BOARD_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 12}; samesite=lax`
    router.push(`${pathname}?sessionId=${encodeURIComponent(id)}`)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-surfaceAlt/60 pl-2.5 pr-2 py-1.5 text-sm text-text transition-colors hover:bg-surfaceAlt hover:border-textMute/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="text-[10px] uppercase tracking-wider text-textMute">분반</span>
        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dotClass(cur?.mode)}`} />
        <span className="max-w-[15ch] truncate font-medium">{cur ? shortTitle(cur.title) : '선택'}</span>
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className={`text-textMute transition-transform duration-150 ${open ? 'rotate-180' : ''}`}>
          <path d="M4 6l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div role="listbox" className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-1.5 shadow-2xl shadow-black/50">
          {sessions.map((s) => {
            const active = s.id === current
            return (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(s.id)}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-accent/10 text-text' : 'text-textDim hover:bg-surfaceAlt hover:text-text'}`}
              >
                <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass(s.mode)}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.title}</span>
                  <span className="block text-[11px] text-textMute">{[s.date ? String(s.date).slice(0, 10) : null, modeLabel(s.mode)].filter(Boolean).join(' · ')}</span>
                </span>
                {active ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" className="mt-0.5 shrink-0 text-accent">
                    <path d="M3 7.4l2.6 2.6L11 4.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

function dotClass(mode?: string): string {
  if (mode === 'live') return 'bg-accent'
  if (mode === 'archived') return 'bg-textMute'
  return 'bg-warn'
}

function modeLabel(mode?: string): string {
  if (mode === 'live') return '진행중'
  if (mode === 'archived') return '종료'
  return '준비'
}

// 긴 제목에서 앞부분(분반/과정)만 트리거에 노출 — 목록에는 전체 제목을 보여준다.
// 분반 라벨(예: 'A반'·'3조')로 끝나면 그것만, 아니면 구분자 앞부분 — 코스명 하드코딩 없이 재사용.
function shortTitle(title: string): string {
  const head = title.split(/[·(]/)[0].trim()
  const ban = head.match(/(\S+반|\d+조)\s*$/)
  return (ban ? ban[1] : head) || title
}
