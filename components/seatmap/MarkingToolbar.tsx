'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/primitives'
import { ClearAllDialog } from './ClearAllDialog'
import { ReasonChips } from './ReasonChips'
import type { BoardMode } from './types'

const MODE_OPTIONS: { value: BoardMode; label: string }[] = [
  { value: 'view', label: '보기' },
  { value: 'mark_problem', label: '문제 마킹' },
  { value: 'mark_resolved', label: '해결 마킹' }
]

const MODE_HINT: Record<BoardMode, string> = {
  view: '좌석을 탭하면 상세 패널이 열립니다.',
  mark_problem: '좌석 탭 = 즉시 문제 표시. 같은 좌석 다시 탭 = 해제.',
  mark_resolved: '좌석 탭 = 즉시 해결 표시. 같은 좌석 다시 탭 = 해제.'
}

type Props = {
  mode: BoardMode
  onSetMode: (mode: BoardMode) => void
  reason: string | null
  onSetReason: (reason: string | null) => void
  soundOn: boolean
  onToggleSound: () => void
  instructorView: boolean
  onToggleInstructorView: () => void
  /** 역할 온보딩 재노출 — 없으면 버튼 미표시. */
  onResetRole?: () => void
  /** 전체 초기화 — 모든 좌석 마크 삭제 (확인 다이얼로그 후). */
  onClearAll?: () => Promise<number>
}

export function MarkingToolbar(props: Props) {
  const { mode, onSetMode, reason, onSetReason } = props
  return (
    <Card className={'px-3 py-2 md:px-4 md:py-3 flex flex-col gap-2 md:gap-2.5 ' + toolbarTone(mode)}>
      <div className="flex items-center gap-2">
        <ModeSwitch mode={mode} onSetMode={onSetMode} />
        <span className="hidden md:block text-xs text-textMute flex-1 min-w-[160px]">{MODE_HINT[mode]}</span>
        <div className="hidden md:flex items-center gap-2">
          <PrefToggle label="알림음" on={props.soundOn} onToggle={props.onToggleSound} />
          <PrefToggle label="강사 뷰" on={props.instructorView} onToggle={props.onToggleInstructorView} />
          {props.onResetRole ? <RoleResetButton onClick={props.onResetRole} /> : null}
          {props.onClearAll ? <ClearAllDialog onClearAll={props.onClearAll} /> : null}
        </div>
        <SettingsPopover {...props} />
      </div>
      {mode === 'mark_problem' ? (
        <div className="flex items-center gap-2 overflow-x-auto md:overflow-visible">
          <span className="text-xs text-textMute shrink-0">탭 마킹 사유</span>
          <ReasonChips current={reason} onSelect={onSetReason} scrollOnMobile />
        </div>
      ) : null}
    </Card>
  )
}

/** 모바일 전용 설정 popover — 알림음/강사 뷰 토글을 아이콘버튼 뒤로 접는다. */
function SettingsPopover(props: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative ml-auto md:hidden">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          'min-w-[44px] min-h-[44px] px-3 text-xs rounded border transition-colors ' +
          (open
            ? 'bg-border border-textMute text-text'
            : 'bg-surfaceAlt border-border text-textDim')
        }
      >
        설정
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-full mt-1 z-40 w-44 p-2 rounded-md border border-border bg-surface shadow-xl flex flex-col gap-2">
            <PrefToggle label="알림음" on={props.soundOn} onToggle={props.onToggleSound} className="w-full" />
            {props.onClearAll ? <ClearAllDialog onClearAll={props.onClearAll} /> : null}
            <PrefToggle
              label="강사 뷰"
              on={props.instructorView}
              onToggle={props.onToggleInstructorView}
              className="w-full"
            />
            {props.onResetRole ? (
              <RoleResetButton
                className="w-full"
                onClick={() => {
                  setOpen(false)
                  props.onResetRole?.()
                }}
              />
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

export function RoleResetButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-reset-role
      onClick={onClick}
      className={
        'px-2.5 py-1.5 min-h-[44px] md:min-h-[36px] text-xs rounded border transition-colors ' +
        'bg-surfaceAlt border-border text-textDim hover:text-text hover:bg-border ' +
        className
      }
    >
      역할 다시 선택
    </button>
  )
}

function toolbarTone(mode: BoardMode): string {
  if (mode === 'mark_problem') return 'border-danger/60'
  if (mode === 'mark_resolved') return 'border-accent/60'
  return ''
}

function ModeSwitch({ mode, onSetMode }: { mode: BoardMode; onSetMode: (m: BoardMode) => void }) {
  return (
    <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="보드 모드">
      {MODE_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={mode === o.value}
          onClick={() => onSetMode(o.value)}
          className={
            'px-3 py-1.5 min-h-[44px] md:min-h-[36px] text-xs font-medium transition-colors ' +
            (mode === o.value ? modeActiveClass(o.value) : 'bg-surfaceAlt text-textDim hover:text-text')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function modeActiveClass(mode: BoardMode): string {
  if (mode === 'mark_problem') return 'bg-danger/25 text-danger'
  if (mode === 'mark_resolved') return 'bg-accent/25 text-accent'
  return 'bg-border text-text'
}

export function PrefToggle({
  label,
  on,
  onToggle,
  className = ''
}: {
  label: string
  on: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={
        'px-2.5 py-1.5 min-h-[44px] md:min-h-[36px] text-xs rounded border transition-colors ' +
        (on
          ? 'bg-accentDim/20 border-accentDim/50 text-accent'
          : 'bg-surfaceAlt border-border text-textDim hover:text-text hover:bg-border') +
        ' ' +
        className
      }
    >
      {label} {on ? 'ON' : 'OFF'}
    </button>
  )
}
