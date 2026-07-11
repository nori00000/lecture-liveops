'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

type NavItem = { href: string; label: string }

// 블럭 분류: 핵심(최상단) → 수업 운영 → 도구 → 관리
const CORE_NAV: NavItem[] = [
  { href: '/today', label: '상황판' },
  { href: '/today/seatmap', label: '좌석 보드' }
]

const CLASS_NAV: NavItem[] = [
  { href: '/today/qna', label: '질문/막힘' },
  { href: '/today/resources', label: '자료 협업' },
  { href: '/today/ops', label: '관찰 로그' },
  { href: '/today/playbook', label: '강사 신호' }
]

const TOOL_NAV: NavItem[] = [
  { href: '/today/llm-launcher', label: 'AI에게 요청' },
  { href: '/today/export', label: '내보내기' }
]

const ADMIN_NAV: NavItem[] = [
  { href: '/sessions', label: '세션 아카이브' },
  { href: '/sessions/new', label: '새 세션' },
  { href: '/companies', label: '기업' },
  { href: '/courses', label: '강의' },
  { href: '/dates', label: '날짜' },
  { href: '/settings', label: '설정' }
]

const ALL_NAV: NavItem[] = [...CORE_NAV, ...CLASS_NAV, ...TOOL_NAV, ...ADMIN_NAV]

type Mode = 'fixture' | 'supabase' | 'neon'

// 현재 경로에 가장 길게 일치하는 단일 항목만 활성으로 판정한다.
// (예: /today/seatmap 에서 '상황판'(/today)과 '좌석 보드'가 동시에 활성으로
//  켜지던 버그를 방지 — 최장 prefix 일치 1개만 활성)
function resolveActiveHref(pathname: string): string | null {
  let best: string | null = null
  for (const item of ALL_NAV) {
    const matches = pathname === item.href || pathname.startsWith(item.href + '/')
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href
    }
  }
  return best
}

// 사용자에게는 DB/구현 명칭(Neon·Supabase·Fixture)을 노출하지 않는다.
function modeLabel(mode: Mode): string {
  return mode === 'fixture' ? '데모 데이터' : '데이터 연결됨'
}

export function Sidebar({ mode }: { mode: Mode }) {
  const pathname = usePathname()
  const activeHref = resolveActiveHref(pathname)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <MobileTopBar mode={mode} pathname={pathname} onMenu={() => setOpen(true)} />
      {open ? (
        <button
          type="button"
          aria-label="닫기"
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-30 bg-black/60 backdrop-blur-sm"
        />
      ) : null}
      <aside
        className={
          'border-r border-border bg-surface flex flex-col h-screen z-40 ' +
          'fixed md:sticky top-0 left-0 ' +
          'w-64 md:w-60 shrink-0 ' +
          'transition-transform duration-200 ease-out ' +
          (open ? 'translate-x-0' : '-translate-x-full md:translate-x-0')
        }
      >
        <div className="px-5 py-5 border-b border-border flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div aria-hidden="true" className="h-10 w-10 rounded-full bg-surfaceAlt ring-1 ring-border shrink-0 flex items-center justify-center text-xs font-semibold">LL</div>
            <div className="min-w-0">
              <div className="text-lg font-semibold tracking-tight">Lecture LiveOps</div>
              <div className="text-xs text-textMute mt-1 truncate">강의 상황판 · 자료 협업</div>
            </div>
          </div>
          <button
            type="button"
            aria-label="사이드바 닫기"
            onClick={() => setOpen(false)}
            className="md:hidden -mr-2 -mt-1 p-2 text-textDim hover:text-text"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M5 5l10 10M15 5l-10 10" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto scrollbar-thin py-3">
          <NavGroup title="지금" items={CORE_NAV} activeHref={activeHref} />
          <NavGroup title="수업 운영" items={CLASS_NAV} activeHref={activeHref} collapsible />
          <NavGroup title="도구" items={TOOL_NAV} activeHref={activeHref} collapsible />
          <NavGroup title="관리" items={ADMIN_NAV} activeHref={activeHref} />
        </nav>
        <ModeBadge mode={mode} />
      </aside>
    </>
  )
}

function MobileTopBar({
  mode,
  pathname,
  onMenu
}: {
  mode: Mode
  pathname: string
  onMenu: () => void
}) {
  const label = inferTitle(pathname)
  return (
    <div className="md:hidden sticky top-0 z-20 flex items-center gap-2 h-12 px-3 border-b border-border bg-surface/95 backdrop-blur">
      <button
        type="button"
        aria-label="메뉴 열기"
        onClick={onMenu}
        className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-textDim hover:text-text"
      >
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 6h14M4 11h14M4 16h14" strokeLinecap="round" />
        </svg>
      </button>
      <div aria-hidden="true" className="h-6 w-6 rounded-full bg-surfaceAlt ring-1 ring-border shrink-0 flex items-center justify-center text-[9px] font-semibold">LL</div>
      <div className="text-sm font-medium truncate flex-1">{label}</div>
      <span
        className={
          'inline-block w-1.5 h-1.5 rounded-full ' +
          (mode === 'fixture' ? 'bg-warn' : 'bg-accent')
        }
        title={modeLabel(mode)}
      />
    </div>
  )
}

function ModeBadge({ mode }: { mode: Mode }) {
  return (
    <div className="px-5 py-3 border-t border-border text-xs">
      <div className="flex items-center gap-2">
        <span
          className={
            mode === 'fixture'
              ? 'inline-block w-1.5 h-1.5 rounded-full bg-warn'
              : 'inline-block w-1.5 h-1.5 rounded-full bg-accent'
          }
        />
        <span className="text-textDim">{modeLabel(mode)}</span>
      </div>
    </div>
  )
}

function NavGroup({
  title,
  items,
  activeHref,
  collapsible = false
}: {
  title: string
  items: NavItem[]
  activeHref: string | null
  collapsible?: boolean
}) {
  const containsActive = items.some((item) => item.href === activeHref)
  const [expanded, setExpanded] = useState(!collapsible || containsActive)

  // 접혀 있어도 활성 경로가 이 그룹으로 들어오면 자동으로 펼쳐 위치를 잃지 않게 한다.
  useEffect(() => {
    if (containsActive) setExpanded(true)
  }, [containsActive])

  const list = (
    <ul>
      {items.map((item) => {
        const active = item.href === activeHref
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={
                'block px-3 py-2 text-sm rounded transition-colors ' +
                (active
                  ? 'bg-surfaceAlt text-text font-medium'
                  : 'text-textDim hover:bg-surfaceAlt hover:text-text')
              }
            >
              {item.label}
            </Link>
          </li>
        )
      })}
    </ul>
  )

  if (!collapsible) {
    return (
      <div className="px-2 mb-4">
        <div className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-textMute">
          {title}
        </div>
        {list}
      </div>
    )
  }

  return (
    <div className="px-2 mb-4">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wider text-textMute hover:text-textDim"
      >
        <span>{title}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className={'transition-transform duration-150 ' + (expanded ? 'rotate-90' : '')}
          aria-hidden="true"
        >
          <path d="M4.5 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {expanded ? list : null}
    </div>
  )
}

function inferTitle(pathname: string): string {
  const href = resolveActiveHref(pathname)
  const item = href ? ALL_NAV.find((n) => n.href === href) : null
  if (item) return item.label
  if (pathname.startsWith('/p/')) return '참가자 페이지'
  return 'Lecture LiveOps'
}
