'use client'

import { useTick } from './board-hooks'

const STALE_AFTER_MS = 6000

type Props = {
  /** 마지막 성공 fetch epoch ms — 아직 없으면 null. */
  lastSyncAt: number | null
  hasError: boolean
}

export function ConnectionStatus({ lastSyncAt, hasError }: Props) {
  const now = useTick(1000)

  if (!hasError && lastSyncAt === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-textMute" role="status">
        <Dot className="bg-textMute" />
        동기화 중
      </span>
    )
  }

  const stale = hasError || lastSyncAt === null || now - lastSyncAt > STALE_AFTER_MS
  if (stale) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger font-medium" role="status">
        <Dot className="bg-danger" />
        동기화 끊김{lastSyncAt !== null ? ` — 마지막 ${formatClock(lastSyncAt)}` : ''}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-textDim" role="status">
      <Dot className="bg-textDim" />
      실시간
    </span>
  )
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={'inline-block w-1.5 h-1.5 rounded-full ' + className} />
}

function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}
