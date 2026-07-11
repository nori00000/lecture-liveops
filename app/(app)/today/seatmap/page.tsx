'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { KeyedMutator } from 'swr'
import { useSessionData } from '@/lib/realtime/channel'
import { invoke } from '@/lib/util/envelope'
import Link from 'next/link'
import { Card, CardHeader, PageHeader, Button } from '@/components/ui/primitives'
import { SessionPicker } from '@/components/liveops/SessionPicker'
import { SeatMapSvg } from '@/components/seatmap/SeatMapSvg'
import { SeatListView } from '@/components/seatmap/SeatListView'
import { SeatDetailPanel } from '@/components/seatmap/SeatDetailPanel'
import { SeatDetailSheet } from '@/components/seatmap/SeatDetailSheet'
import { CommandBar } from '@/components/seatmap/CommandBar'
import { MarkingToolbar, PrefToggle, RoleResetButton } from '@/components/seatmap/MarkingToolbar'
import { SignalStrip } from '@/components/seatmap/SignalStrip'
import { ConnectionStatus } from '@/components/seatmap/ConnectionStatus'
import { ProblemStrip } from '@/components/seatmap/ProblemStrip'
import { FocusCard } from '@/components/seatmap/FocusCard'
import { RoleOnboarding } from '@/components/seatmap/RoleOnboarding'
import {
  useLocalPref,
  useMediaQuery,
  useProblemAlerts,
  useSeatmapRole,
  useSeatmapView,
  useSoundPing,
  useTick
} from '@/components/seatmap/board-hooks'
import type { SeatmapRole, SeatmapView } from '@/components/seatmap/board-hooks'
import {
  REASON_OPTIONS,
  countResolved,
  countSeats,
  elapsedMinutes,
  findTableBySeat,
  sortMarksBySeat,
  upsertMark
} from '@/components/seatmap/seat-utils'
import type {
  BoardMode,
  SeatLayoutConfig,
  SeatMark,
  SeatStatus,
  SeatmapResponse
} from '@/components/seatmap/types'

const MODE_VALUES = ['view', 'mark_problem', 'mark_resolved'] as const
const ONOFF_VALUES = ['on', 'off'] as const
/** 사유 프리퍼런스 허용값 — 프리셋 사유 + 'none'(미선택). */
const REASON_PREF_VALUES: readonly string[] = [...REASON_OPTIONS.map((o) => o.value), 'none']
const MODE_TITLE: Record<BoardMode, string> = {
  view: '보기',
  mark_problem: '문제 마킹 모드',
  mark_resolved: '해결 마킹 모드'
}
/** 마킹 모드 상단 배지 문구 — "지금 어떤 모드인지 + 탭하면 무엇이 되는지"를 명시해 오마킹을 막는다. */
const MARKING_BANNER_LABEL: Record<'mark_problem' | 'mark_resolved', string> = {
  mark_problem: '문제 마킹 모드 — 좌석을 탭하면 문제로 표시',
  mark_resolved: '해결 마킹 모드 — 좌석을 탭하면 해결로 표시'
}

export default function SeatmapPage() {
  return (
    <Suspense fallback={<div className="p-6"><InfoCard text="좌석 보드를 불러오는 중입니다." /></div>}>
      <SeatmapPageInner />
    </Suspense>
  )
}

function SeatmapPageInner() {
  // ?sessionId= 가 있으면 그 세션을, 없으면 활성 세션(getToday)을 대상으로 한다.
  const override = useSearchParams().get('sessionId')
  const { data } = useSessionData<{ session?: { id: string } }>('/api/data/session')
  const effectiveId = override ?? data?.session?.id ?? null
  const builderHref = effectiveId ? `/today/seatmap/builder?sessionId=${effectiveId}` : '/today/seatmap/builder'

  return (
    <div className="p-0 md:p-6">
      <div className="max-md:[&_p]:hidden">
        <PageHeader
          title="좌석 보드"
          desc="좌석 신호등 — 문제 자리를 한눈에 공유"
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <SessionPicker current={effectiveId} />
              <Link href={builderHref}>
                <Button size="sm">배치도 편집</Button>
              </Link>
            </div>
          }
        />
      </div>
      {!override && !data ? (
        <InfoCard text="세션 정보를 불러오는 중입니다." />
      ) : !effectiveId ? (
        <InfoCard text="세션이 없습니다. 위 '세션'에서 고르거나 새 세션을 시작해 주세요." />
      ) : (
        <SeatmapBoard key={effectiveId} sessionId={effectiveId} />
      )}
    </div>
  )
}

function SeatmapBoard({ sessionId }: { sessionId: string }) {
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const { data, error, mutate } = useSessionData<SeatmapResponse>(
    `/api/data/seatmap?sessionId=${encodeURIComponent(sessionId)}`,
    2000,
    { onSuccess: () => setLastSyncAt(Date.now()) }
  )
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const board = useBoardControls()
  const { saving, sendError, updateMark } = useSeatMarkUpdater(sessionId, mutate)
  const clearAll = useClearAllMarks(sessionId, mutate, () => setSelectedKey(null))
  const sound = useSoundPing()
  const now = useTick(30_000)
  const roleCtl = useSeatmapRole()
  const [view, setView] = useSeatmapView()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const [soundNotice, setSoundNotice] = useState(false)

  const marks = data?.marks ?? []
  const problems = sortMarksBySeat(marks.filter((m) => m.status === 'problem'))
  const pulsing = useProblemAlerts(data ? problems.length : null, sound.ping)

  if (roleCtl.role === 'unset') {
    const deps = { roleCtl, board, setView, isMobile, soundOn: sound.soundOn, setSoundNotice }
    return <RoleOnboarding onSelect={(r) => applyRolePreset(r, deps)} />
  }
  const gate = boardGateMessage(roleCtl.role, data, error)
  if (gate) return gate

  return (
    <BoardView
      sessionId={sessionId}
      layoutName={data!.layout!.name}
      layout={data!.layout!.layout}
      marks={marks}
      problems={problems}
      selectedKey={selectedKey}
      onSelectKey={setSelectedKey}
      board={board}
      sound={sound}
      saving={saving}
      sendError={sendError}
      updateMark={updateMark}
      pulsing={pulsing}
      now={now}
      lastSyncAt={lastSyncAt}
      hasError={Boolean(error)}
      view={view}
      onSetView={setView}
      soundNotice={soundNotice}
      onDismissNotice={() => setSoundNotice(false)}
      onResetRole={roleCtl.resetRole}
      clearAll={clearAll}
      onCommandApplied={() => void mutate().catch(() => undefined)}
    />
  )
}

/** 보드 본문 진입 전 게이트 — 역할 로딩/데이터 로딩/오류/배치도 없음 순서로 안내. */
function boardGateMessage(
  role: SeatmapRole | 'unset' | null,
  data: SeatmapResponse | undefined,
  error: unknown
): React.ReactElement | null {
  if (role === null) return <InfoCard text="보드를 준비하는 중입니다." />
  if (error && !data) {
    return <InfoCard text="좌석 데이터를 불러올 수 없습니다. 데이터 레이어가 아직 준비 중일 수 있습니다." />
  }
  if (!data) return <InfoCard text="배치도를 불러오는 중입니다." />
  if (!data.layout) {
    return <InfoCard title="배치도 없음" text="아직 배치도가 없습니다 — 오른쪽 위 '배치도 편집'에서 팀을 만들고 명단을 붙여넣어 저장하세요." />
  }
  return null
}

type RolePresetDeps = {
  roleCtl: ReturnType<typeof useSeatmapRole>
  board: ReturnType<typeof useBoardControls>
  setView: (v: SeatmapView) => void
  isMobile: boolean
  soundOn: boolean
  setSoundNotice: (v: boolean) => void
}

/** 역할 선택 즉시 화면 프리셋 — 퍼실리테이터=마킹 동선, 강사=모니터링 동선 + 알림음 권장 안내. */
function applyRolePreset(role: SeatmapRole, d: RolePresetDeps) {
  d.roleCtl.setRole(role)
  if (role === 'facilitator') {
    d.board.setInstructorView(false)
    d.board.setMode('mark_problem')
    if (d.isMobile) d.setView('list')
    return
  }
  d.board.setInstructorView(true)
  d.board.setMode('view')
  d.setView('board')
  if (!d.soundOn) d.setSoundNotice(true)
}

type UpdateMarkFn = (
  seatKey: string,
  status: SeatStatus,
  extra?: { reason?: string; memo?: string }
) => Promise<void>

type BoardControls = ReturnType<typeof useBoardControls>
type SoundControls = ReturnType<typeof useSoundPing>

type BoardViewProps = {
  sessionId: string
  layoutName: string
  layout: SeatLayoutConfig
  marks: SeatMark[]
  problems: SeatMark[]
  selectedKey: string | null
  onSelectKey: (seatKey: string | null) => void
  board: BoardControls
  sound: SoundControls
  saving: boolean
  sendError: boolean
  updateMark: UpdateMarkFn
  pulsing: boolean
  now: number
  lastSyncAt: number | null
  hasError: boolean
  view: SeatmapView | null
  onSetView: (v: SeatmapView) => void
  soundNotice: boolean
  onDismissNotice: () => void
  onResetRole: () => void
  clearAll: () => Promise<number>
  onCommandApplied: () => void
}

/** 모바일(<md) 순서: 포커스/문제 스트립 → 마킹 툴바 → 보드/목록 → 신호 스트립.
 *  데스크톱은 DOM 순서(현 배치) 그대로 — md:order-none. */
function BoardView(p: BoardViewProps) {
  const iv = p.board.instructorView
  const staleKeys = computeStaleKeys(p.problems, p.now)
  const tap = createSeatTapHandler(p)
  return (
    <div className="flex flex-col gap-3 md:gap-4">
      <BoardTop {...p} iv={iv} />
      {p.sendError ? (
        <div className="order-2 md:order-none">
          <MarkErrorNotice />
        </div>
      ) : null}
      <div className="order-2 md:order-none">
        <ProblemStrip
          layout={p.layout}
          problems={p.problems}
          resolvedCount={countResolved(p.marks)}
          selectedKey={p.selectedKey}
          onSelect={p.onSelectKey}
          pulsing={p.pulsing}
          now={p.now}
          large={false}
          trailing={iv ? null : <ConnectionStatus lastSyncAt={p.lastSyncAt} hasError={p.hasError} />}
        />
      </div>
      <div className="order-5 md:order-none">
        <SignalStrip sessionId={p.sessionId} large={iv} />
      </div>
      {!iv ? (
        <div className="order-3 md:order-none">
          <CommandBar sessionId={p.sessionId} onApplied={p.onCommandApplied} />
        </div>
      ) : null}
      <div className="order-4 md:order-none">
        <BoardArea
          layoutName={p.layoutName}
          layout={p.layout}
          marks={p.marks}
          selectedKey={p.selectedKey}
          onSeatTap={tap}
          staleKeys={staleKeys}
          mode={p.board.mode}
          instructorView={iv}
          view={p.view}
          onSetView={p.onSetView}
          panel={iv ? null : <BoardPanel {...p} />}
        />
      </div>
      <BoardSheet {...p} />
    </div>
  )
}

/** 헤더 + (강사) 단일 포커스 카드 또는 (퍼실리테이터) 마킹 툴바 + 알림음 권장 1줄. */
function BoardTop(p: BoardViewProps & { iv: boolean }) {
  return (
    <>
      <BoardHeaderRow
        className={(p.iv ? 'flex' : 'hidden md:flex') + ' order-1 md:order-none'}
        lastSyncAt={p.lastSyncAt}
        hasError={p.hasError}
        instructorView={p.iv}
        onToggleInstructorView={p.board.toggleInstructorView}
        onResetRole={p.iv ? p.onResetRole : undefined}
      />
      {p.soundNotice ? (
        <div className="order-1 md:order-none">
          <SoundNotice soundOn={p.sound.soundOn} onEnable={p.sound.toggle} onDismiss={p.onDismissNotice} />
        </div>
      ) : null}
      {p.iv ? (
        <div className="order-2 md:order-none">
          <FocusCard
            layout={p.layout}
            problems={p.problems}
            marks={p.marks}
            selectedKey={p.selectedKey}
            now={p.now}
            saving={p.saving}
            onSelect={p.onSelectKey}
            onResolve={createFocusResolveHandler(p)}
          />
        </div>
      ) : (
        <div className="order-3 md:order-none">
          <BoardToolbar board={p.board} sound={p.sound} onResetRole={p.onResetRole} clearAll={p.clearAll} />
        </div>
      )}
    </>
  )
}

/** 강사 역할 선택 직후 1줄 안내 — 알림음 켜기 권장(즉시 켜기 버튼 포함). */
function SoundNotice({ soundOn, onEnable, onDismiss }: { soundOn: boolean; onEnable: () => void; onDismiss: () => void }) {
  return (
    <div
      data-sound-notice
      className="flex items-center gap-2 px-3 py-2 rounded-md border border-accentDim/40 bg-accentDim/10 text-xs text-textDim"
    >
      <span className="flex-1 min-w-0">새 문제가 생기면 소리로 바로 알 수 있도록 알림음을 켜 두는 것을 권장합니다.</span>
      {!soundOn ? (
        <button
          type="button"
          onClick={() => {
            onEnable()
            onDismiss()
          }}
          className="shrink-0 min-h-[36px] px-2.5 rounded border border-accentDim/50 text-accent transition-colors hover:bg-accentDim/20"
        >
          알림음 켜기
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="안내 닫기"
        className="shrink-0 min-h-[36px] px-2 rounded border border-border text-textMute transition-colors hover:text-text"
      >
        닫기
      </button>
    </div>
  )
}

/** 강사 즉석 해결 — 포커스 좌석을 resolved로 마킹하고 선택을 해제한다(기존 사유/메모 유지). */
function createFocusResolveHandler(p: BoardViewProps): (seatKey: string) => void {
  return (seatKey: string) => {
    const mark = p.marks.find((m) => m.seat_key === seatKey) ?? null
    void p.updateMark(seatKey, 'resolved', keepExtra(mark))
    p.onSelectKey(null)
  }
}

/** 마킹 전송 실패 안내 — 낙관 마크는 롤백된 상태이므로 재시도를 유도한다. */
function MarkErrorNotice() {
  return (
    <div
      role="status"
      data-mark-error
      className="px-3 py-2.5 rounded-md border border-[#d64545]/60 bg-[#d64545]/10 text-sm text-[#ef8080]"
    >
      전송 실패 — 연결 확인 후 다시 탭하세요
    </div>
  )
}

/** 좌석 탭 = 항상 그 좌석을 선택(오른쪽 상세 갱신). 보기/강사 뷰는 선택만,
 *  마킹 모드는 선택과 함께 상태 적용(같은 상태 재탭 = 해제). */
function createSeatTapHandler(p: BoardViewProps): (seatKey: string) => void {
  return (seatKey: string) => {
    // 어느 모드든 탭한 좌석을 선택 → 오른쪽 상세가 매번 그 좌석으로 바뀐다.
    p.onSelectKey(seatKey)
    if (p.board.instructorView || p.board.mode === 'view') return
    const target: SeatStatus = p.board.mode === 'mark_problem' ? 'problem' : 'resolved'
    const current = p.marks.find((m) => m.seat_key === seatKey)
    if (current?.status === target) {
      // 같은 상태 재탭 = 해제. 실수 해제 방지 — 명시적 확인을 받은 뒤에만 해제한다.
      // (사유/메모는 보존해 재마킹 시 주석이 사라지지 않게 한다.)
      const label = target === 'problem' ? '문제' : '해결'
      if (window.confirm(`이 좌석의 '${label}' 마킹을 해제할까요?`)) {
        void p.updateMark(seatKey, 'none', keepExtra(current))
      }
      return
    }
    const reason = p.board.mode === 'mark_problem' ? p.board.reason ?? undefined : current?.reason || undefined
    void p.updateMark(seatKey, target, { reason, memo: current?.memo || undefined })
  }
}

function BoardHeaderRow({
  className = '',
  lastSyncAt,
  hasError,
  instructorView,
  onToggleInstructorView,
  onResetRole
}: {
  className?: string
  lastSyncAt: number | null
  hasError: boolean
  instructorView: boolean
  onToggleInstructorView: () => void
  onResetRole?: () => void
}) {
  return (
    <div className={'flex-wrap items-center justify-between gap-2 ' + className}>
      <ConnectionStatus lastSyncAt={lastSyncAt} hasError={hasError} />
      {instructorView ? (
        <div className="flex items-center gap-2">
          {onResetRole ? <RoleResetButton onClick={onResetRole} /> : null}
          <PrefToggle label="강사 뷰" on onToggle={onToggleInstructorView} />
        </div>
      ) : null}
    </div>
  )
}

function BoardToolbar({
  board,
  sound,
  onResetRole,
  clearAll
}: {
  board: BoardControls
  sound: SoundControls
  onResetRole: () => void
  clearAll: () => Promise<number>
}) {
  return (
    <MarkingToolbar
      mode={board.mode}
      onSetMode={board.setMode}
      reason={board.reason}
      onSetReason={board.setReason}
      soundOn={sound.soundOn}
      onToggleSound={sound.toggle}
      instructorView={board.instructorView}
      onToggleInstructorView={board.toggleInstructorView}
      onResetRole={onResetRole}
      onClearAll={clearAll}
    />
  )
}

function BoardPanel(p: BoardViewProps) {
  const mark = p.selectedKey ? p.marks.find((m) => m.seat_key === p.selectedKey) ?? null : null
  const table = p.selectedKey ? findTableBySeat(p.layout, p.selectedKey) : null
  return (
    <SeatDetailPanel
      seatKey={p.selectedKey}
      table={table}
      mark={mark}
      saving={p.saving}
      {...createPanelHandlers(p, p.selectedKey, mark)}
    />
  )
}

/** 모바일 전용 좌석 상세 바텀시트 — 보기 모드에서 좌석 탭 시 열린다. */
function BoardSheet(p: BoardViewProps) {
  const isMobile = useMediaQuery('(max-width: 767px)')
  const key = p.selectedKey
  if (!isMobile || !key || p.board.instructorView) return null
  const mark = p.marks.find((m) => m.seat_key === key) ?? null
  return (
    <SeatDetailSheet
      seatKey={key}
      table={findTableBySeat(p.layout, key)}
      mark={mark}
      saving={p.saving}
      {...createPanelHandlers(p, key, mark)}
      onClose={() => p.onSelectKey(null)}
    />
  )
}

function createPanelHandlers(p: BoardViewProps, key: string | null, mark: SeatMark | null) {
  return {
    onSetStatus: (s: SeatStatus) => {
      if (key) void p.updateMark(key, s, s === 'none' ? undefined : keepExtra(mark))
    },
    onSetReason: (r: string | null) => {
      if (key) void p.updateMark(key, mark?.status ?? 'none', { reason: r ?? undefined, memo: mark?.memo || undefined })
    },
    onSaveMemo: (memo: string) => {
      if (key) void p.updateMark(key, mark?.status ?? 'none', { reason: mark?.reason || undefined, memo })
    }
  }
}

/** 모드/사유/강사 뷰 — 모두 localStorage 유지(사유는 새로고침 후에도 재선택 불필요). */
function useBoardControls() {
  const [mode, setMode] = useLocalPref<BoardMode>('liveops.seatmap.mode', 'view', MODE_VALUES)
  const [viewPref, setViewPref] = useLocalPref<'on' | 'off'>('liveops.seatmap.instructorView', 'off', ONOFF_VALUES)
  const [reasonPref, setReasonPref] = useLocalPref<string>('liveops.seatmap.reason', 'none', REASON_PREF_VALUES)
  return {
    mode,
    setMode,
    reason: reasonPref === 'none' ? null : reasonPref,
    setReason: (r: string | null) => setReasonPref(r ?? 'none'),
    instructorView: viewPref === 'on',
    setInstructorView: (on: boolean) => setViewPref(on ? 'on' : 'off'),
    toggleInstructorView: () => setViewPref(viewPref === 'on' ? 'off' : 'on')
  }
}

function keepExtra(mark: SeatMark | null): { reason?: string; memo?: string } {
  return { reason: mark?.reason || undefined, memo: mark?.memo || undefined }
}

function computeStaleKeys(problems: SeatMark[], now: number): Set<string> {
  const keys = problems
    .filter((m) => {
      const mins = elapsedMinutes(m.updated_at, now)
      return mins !== null && mins >= 5
    })
    .map((m) => m.seat_key)
  return new Set(keys)
}

function useSeatMarkUpdater(sessionId: string, mutate: KeyedMutator<SeatmapResponse>) {
  const [saving, setSaving] = useState(false)
  const [sendError, setSendError] = useState(false)

  async function updateMark(seatKey: string, status: SeatStatus, extra?: { reason?: string; memo?: string }) {
    setSaving(true)
    setSendError(false)
    let snapshot: SeatMark[] | null = null
    try {
      await mutate(
        (prev) => {
          if (!prev) return prev
          snapshot = prev.marks ?? []
          return { ...prev, marks: upsertMark(prev.marks ?? [], seatKey, status, extra) }
        },
        { revalidate: false }
      )
      await invoke({
        action: 'liveops.update_seat_mark',
        role: 'assistant',
        scope: { sessionId },
        input: {
          sessionId,
          seatKey,
          status,
          ...(extra?.reason !== undefined ? { reason: extra.reason } : {}),
          ...(extra?.memo !== undefined ? { memo: extra.memo } : {})
        }
      })
      await mutate().catch(() => undefined)
    } catch {
      await rollbackMarks(mutate, snapshot)
      setSendError(true)
    } finally {
      setSaving(false)
    }
  }

  return { saving, sendError, updateMark }
}

/** 전송 실패 시 낙관 마크를 직전 상태로 되돌리고 서버 상태 재요청을 시도한다(오프라인이면 폴링이 복구). */
// 전체 초기화 — 확인 다이얼로그(ClearAllDialog)를 통과한 후에만 호출된다.
function useClearAllMarks(
  sessionId: string,
  mutate: KeyedMutator<SeatmapResponse>,
  onCleared: () => void
) {
  return async (): Promise<number> => {
    const res = (await invoke({
      action: 'liveops.clear_seat_marks',
      role: 'assistant',
      scope: { sessionId },
      input: { sessionId }
    })) as { ok?: boolean; data?: { cleared?: number } }
    if (!res?.ok) {
      throw new Error('clear failed')
    }
    onCleared()
    await mutate().catch(() => undefined)
    return res.data?.cleared ?? 0
  }
}

async function rollbackMarks(mutate: KeyedMutator<SeatmapResponse>, snapshot: SeatMark[] | null) {
  if (snapshot) {
    await mutate((prev) => (prev ? { ...prev, marks: snapshot } : prev), { revalidate: false }).catch(() => undefined)
  }
  void mutate().catch(() => undefined)
}

type BoardAreaProps = {
  layoutName: string
  layout: SeatLayoutConfig
  marks: SeatMark[]
  selectedKey: string | null
  onSeatTap: (seatKey: string) => void
  staleKeys: ReadonlySet<string>
  mode: BoardMode
  instructorView: boolean
  view: SeatmapView | null
  onSetView: (v: SeatmapView) => void
  panel: React.ReactNode
}

function BoardArea(p: BoardAreaProps) {
  const marking = !p.instructorView && p.mode !== 'view'
  const hint = `좌석 ${countSeats(p.layout)}석` + (marking ? ` · ${MODE_TITLE[p.mode]}` : '')
  const content = (
    <div className="flex flex-col gap-2 min-w-0">
      <ViewSwitchRow view={p.view} onSetView={p.onSetView} hint={p.view === 'list' ? hint : null} />
      <MarkingBoardFrame mode={p.mode} marking={marking}>
        <BoardOrList {...p} marking={marking} hint={hint} />
      </MarkingBoardFrame>
    </div>
  )
  if (p.instructorView) return content
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
      {content}
      <div className="hidden md:block">{p.panel}</div>
    </div>
  )
}

/** 마킹 모드 활성 시 보드(SVG/목록)를 감싸는 틴트 프레임 — 상단에 큰 모드 배지를 함께 노출한다.
 *  보기/강사 뷰(마킹 비활성)에서는 프레임 없이 자식만 렌더한다.
 *  좌측 세로 막대 없이 전체 1px 테두리 + 옅은 배경 틴트 + 점(dot)·배지로만 모드를 표시한다. */
function MarkingBoardFrame({
  mode,
  marking,
  children
}: {
  mode: BoardMode
  marking: boolean
  children: React.ReactNode
}) {
  if (!marking || mode === 'view') return <>{children}</>
  return (
    <div
      data-marking-frame={mode}
      className={'flex flex-col gap-2 rounded-lg border p-1.5 md:p-2 ' + markingFrameTone(mode)}
    >
      <MarkingModeBanner mode={mode} />
      {children}
    </div>
  )
}

/** 현재 마킹 모드 라벨 배지 — 점(dot) + 큰 라벨. 모드 전환을 스크린리더에도 알린다(aria-live). */
function MarkingModeBanner({ mode }: { mode: 'mark_problem' | 'mark_resolved' }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-marking-banner={mode}
      className={
        'flex items-center gap-2 px-3 py-2 md:px-3.5 md:py-2.5 rounded-md border text-sm md:text-base font-semibold ' +
        markingBannerTone(mode)
      }
    >
      <span aria-hidden="true" className={'inline-block w-2.5 h-2.5 rounded-full shrink-0 ' + markingDotTone(mode)} />
      <span>{MARKING_BANNER_LABEL[mode]}</span>
    </div>
  )
}

function markingFrameTone(mode: BoardMode): string {
  if (mode === 'mark_problem') return 'border-danger/40 bg-danger/5'
  if (mode === 'mark_resolved') return 'border-accent/40 bg-accent/5'
  return ''
}

function markingBannerTone(mode: BoardMode): string {
  if (mode === 'mark_problem') return 'border-danger/40 bg-danger/10 text-danger'
  if (mode === 'mark_resolved') return 'border-accent/40 bg-accent/10 text-accent'
  return ''
}

function markingDotTone(mode: BoardMode): string {
  if (mode === 'mark_problem') return 'bg-danger'
  return 'bg-accent'
}

function BoardOrList(p: BoardAreaProps & { marking: boolean; hint: string }) {
  if (p.view === null) return null
  if (p.view === 'list') {
    return (
      <SeatListView
        layout={p.layout}
        marks={p.marks}
        selectedKey={p.selectedKey}
        staleKeys={p.staleKeys}
        onSeatTap={p.onSeatTap}
      />
    )
  }
  return (
    <Card>
      <CardHeader title={p.layoutName || '좌석 배치도'} hint={p.hint} />
      <div className="p-2 md:p-4">
        <SeatMapSvg
          layout={p.layout}
          marks={p.marks}
          selectedKey={p.selectedKey}
          onSelect={p.onSeatTap}
          staleKeys={p.staleKeys}
          large={p.instructorView}
        />
      </div>
    </Card>
  )
}

function ViewSwitchRow({
  view,
  onSetView,
  hint
}: {
  view: SeatmapView | null
  onSetView: (v: SeatmapView) => void
  hint: string | null
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="inline-flex rounded border border-border overflow-hidden" role="group" aria-label="보드 표시 방식">
        <ViewSwitchButton label="배치도" active={view === 'board'} onClick={() => onSetView('board')} />
        <ViewSwitchButton label="목록" active={view === 'list'} onClick={() => onSetView('list')} />
      </div>
      {hint ? <span className="text-xs text-textMute">{hint}</span> : null}
    </div>
  )
}

function ViewSwitchButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={
        'px-4 min-h-[44px] md:min-h-[32px] text-xs font-medium transition-colors ' +
        (active ? 'bg-border text-text' : 'bg-surfaceAlt text-textDim hover:text-text')
      }
    >
      {label}
    </button>
  )
}

function InfoCard({ title, text }: { title?: string; text: string }) {
  return (
    <Card>
      {title ? <CardHeader title={title} /> : null}
      <div className="p-4 text-sm text-textDim">{text}</div>
    </Card>
  )
}
