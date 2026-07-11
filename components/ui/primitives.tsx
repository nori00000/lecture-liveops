'use client'

import { useEffect } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes } from 'react'

export function Card({ className = '', ...p }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={'bg-surface border border-border rounded-md ' + className}
      {...p}
    />
  )
}

export function CardHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-3 border-b border-border flex items-center justify-between">
      <h2 className="text-sm font-medium text-text">{title}</h2>
      {hint ? <div className="text-xs text-textMute">{hint}</div> : null}
    </div>
  )
}

export function Badge({
  children,
  tone = 'neutral'
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'accent' | 'warn' | 'danger' | 'info'
}) {
  const map: Record<string, string> = {
    neutral: 'bg-surfaceAlt text-textDim border-border',
    accent: 'bg-accentDim/20 text-accent border-accentDim/40',
    warn: 'bg-warn/15 text-warn border-warn/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    info: 'bg-info/15 text-info border-info/30'
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[11px] rounded border ${map[tone]}`}>
      {children}
    </span>
  )
}

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'accent' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}) {
  const v: Record<string, string> = {
    default: 'bg-surfaceAlt border border-border text-text hover:bg-border',
    accent: 'bg-accentDim border border-accent text-text hover:bg-accent/30',
    ghost: 'bg-transparent border border-transparent text-textDim hover:bg-surfaceAlt hover:text-text',
    danger: 'bg-danger/20 border border-danger/40 text-danger hover:bg-danger/30'
  }
  const s = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
  return (
    <button
      className={`${v[variant]} ${s} rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
      {...p}
    />
  )
}

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...p}
      className={
        'w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-text placeholder-textMute focus:outline-none focus:border-accent ' +
        (p.className ?? '')
      }
    />
  )
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...p}
      className={
        'w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-text placeholder-textMute focus:outline-none focus:border-accent ' +
        (p.className ?? '')
      }
    />
  )
}

export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...p}
      className={
        'bg-bg border border-border rounded px-2 py-1.5 text-sm text-text focus:outline-none focus:border-accent ' +
        (p.className ?? '')
      }
    />
  )
}

export function PageHeader({ title, desc, right }: { title: string; desc?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-text">{title}</h1>
        {desc ? <p className="text-sm text-textDim mt-1">{desc}</p> : null}
      </div>
      {right ? <div className="flex flex-wrap gap-2">{right}</div> : null}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <div className="bg-surface border border-border rounded-lg w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="text-sm font-medium">{title}</div>
          <Button size="sm" variant="ghost" onClick={onClose}>닫기</Button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}

export function Tabs({
  tabs,
  active,
  onChange
}: {
  tabs: { id: string; label: string }[]
  active: string
  onChange: (id: string) => void
}) {
  return (
    <div className="border-b border-border flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={
            'px-3 py-2 text-sm border-b-2 -mb-px transition-colors ' +
            (active === t.id
              ? 'border-accent text-text'
              : 'border-transparent text-textDim hover:text-text')
          }
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
