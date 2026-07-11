'use client'

import { useEffect, useRef, useState } from 'react'

/** localStorage 유지 문자열 프리퍼런스 — SSR 안전(마운트 후 로드). */
export function useLocalPref<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[]
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(fallback)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key)
      if (stored && (allowed as readonly string[]).includes(stored)) setValue(stored as T)
    } catch {
      // localStorage 차단 환경 — fallback 유지
    }
    // allowed는 호출부에서 상수 배열로 고정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function set(v: T) {
    setValue(v)
    try {
      window.localStorage.setItem(key, v)
    } catch {
      // 저장 실패해도 세션 동안은 상태로 유지
    }
  }

  return [value, set]
}

export type SeatmapView = 'board' | 'list'

const VIEW_PREF_KEY = 'liveops.seatmap.view'

/** 배치도/목록 뷰 — localStorage 유지. 저장값이 없으면 마운트 후 뷰포트로 판정한다(SSR 미스매치 방지).
 *  판정 전에는 null을 반환하므로 호출부는 보드 영역 렌더를 잠시 보류한다. */
export function useSeatmapView(): [SeatmapView | null, (v: SeatmapView) => void] {
  const [view, setView] = useState<SeatmapView | null>(null)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_PREF_KEY)
      if (stored === 'board' || stored === 'list') {
        setView(stored)
        return
      }
    } catch {
      // localStorage 차단 환경 — 뷰포트 기본값으로 진행
    }
    setView(window.matchMedia('(max-width: 767px)').matches ? 'list' : 'board')
  }, [])

  function set(v: SeatmapView) {
    setView(v)
    try {
      window.localStorage.setItem(VIEW_PREF_KEY, v)
    } catch {
      // 저장 실패해도 세션 동안은 상태로 유지
    }
  }

  return [view, set]
}

export type SeatmapRole = 'facilitator' | 'instructor'

const ROLE_PREF_KEY = 'liveops.seatmap.role'

/** 역할 프리퍼런스 — null=로딩(SSR 직후), 'unset'=미선택(온보딩 카드 노출). */
export function useSeatmapRole(): {
  role: SeatmapRole | 'unset' | null
  setRole: (r: SeatmapRole) => void
  resetRole: () => void
} {
  const [role, setRoleState] = useState<SeatmapRole | 'unset' | null>(null)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(ROLE_PREF_KEY)
      setRoleState(stored === 'facilitator' || stored === 'instructor' ? stored : 'unset')
    } catch {
      setRoleState('unset')
    }
  }, [])

  function setRole(r: SeatmapRole) {
    setRoleState(r)
    try {
      window.localStorage.setItem(ROLE_PREF_KEY, r)
    } catch {
      // 저장 실패해도 세션 동안은 상태로 유지
    }
  }

  function resetRole() {
    setRoleState('unset')
    try {
      window.localStorage.removeItem(ROLE_PREF_KEY)
    } catch {
      // 제거 실패 무시 — 상태는 이미 unset
    }
  }

  return { role, setRole, resetRole }
}

/** count 증가 순간 600ms 플래시 — 해결 보상 강조용(motion-safe 애니메이션과 조합). */
export function useFlashOnIncrease(count: number): boolean {
  const [flash, setFlash] = useState(false)
  const prevRef = useRef(count)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = count
    if (count <= prev) return
    setFlash(true)
    const id = window.setTimeout(() => setFlash(false), 600)
    return () => window.clearTimeout(id)
  }, [count])

  return flash
}

/** 미디어쿼리 매칭 — SSR에서는 false, 마운트 후 실제 값으로 갱신. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(query)
    setMatches(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** 바텀시트 열림 동안 body 스크롤 잠금 — 언마운트 시 원복. */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [locked])
}

/** ms 간격으로 갱신되는 현재 시각(epoch ms) — 경과 시간/연결 상태 표시용. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

const SOUND_PREF_KEY = 'liveops.seatmap.sound'

/** Web Audio 비프 — 기본 OFF, 토글은 localStorage 유지.
 *  AudioContext는 사용자 제스처(토글 클릭 또는 첫 pointerdown) 이후에만 생성한다. */
export function useSoundPing() {
  const [enabled, setEnabled] = useLocalPref(SOUND_PREF_KEY, 'off', ['on', 'off'] as const)
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (enabled !== 'on' || ctxRef.current) return
    const onGesture = () => {
      if (!ctxRef.current) ctxRef.current = new AudioContext()
    }
    window.addEventListener('pointerdown', onGesture, { once: true })
    return () => window.removeEventListener('pointerdown', onGesture)
  }, [enabled])

  function toggle() {
    const next = enabled === 'on' ? 'off' : 'on'
    setEnabled(next)
    if (next === 'on' && !ctxRef.current) ctxRef.current = new AudioContext()
  }

  function ping() {
    if (enabled !== 'on' || !ctxRef.current) return
    const ctx = ctxRef.current
    if (ctx.state === 'suspended') void ctx.resume()
    beep(ctx)
  }

  return { soundOn: enabled === 'on', toggle, ping }
}

function beep(ctx: AudioContext) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = 880
  const t = ctx.currentTime
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + 0.3)
}

/** problem 좌석 수 증가 감지 — 2초 펄스 + document.title 갱신 + 사운드 핑.
 *  count가 null이면 아직 데이터 미수신으로 간주한다. */
export function useProblemAlerts(count: number | null, ping: () => void) {
  const [pulsing, setPulsing] = useState(false)
  const prevRef = useRef<number | null>(null)
  const baseTitleRef = useRef<string | null>(null)

  useEffect(() => {
    if (count === null) return
    const prev = prevRef.current
    prevRef.current = count
    if (prev === null || count <= prev) return
    setPulsing(true)
    ping()
    const id = window.setTimeout(() => setPulsing(false), 2000)
    return () => window.clearTimeout(id)
    // ping은 렌더마다 새 함수지만 증가 시점에만 1회 호출하면 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  useEffect(() => {
    if (baseTitleRef.current === null) baseTitleRef.current = document.title
    if (count !== null && count > 0) {
      document.title = `(${count}) 좌석 보드 — Lecture LiveOps`
    } else {
      document.title = baseTitleRef.current
    }
    return () => {
      if (baseTitleRef.current !== null) document.title = baseTitleRef.current
    }
  }, [count])

  return pulsing
}
