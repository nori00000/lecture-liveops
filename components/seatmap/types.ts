export type SeatStatus = 'none' | 'problem' | 'resolved'

export type SeatZone = {
  id: string
  label: string
  kind: 'screen' | 'desk'
  x: number
  y: number
  w: number
  h: number
}

export type SeatDef = {
  key: string
  angleDeg?: number
  ox?: number
  oy?: number
}

export type SeatTable = {
  label: string
  kind?: 'round' | 'rect' | 'tshape'
  cx: number
  cy: number
  r?: number
  w?: number
  h?: number
  stemW?: number
  stemH?: number
  seats: SeatDef[]
  roster?: string[]
}

export type SeatLayoutConfig = {
  zones: SeatZone[]
  tables: SeatTable[]
}

export type SeatMark = {
  seat_key: string
  status: SeatStatus
  reason: string | null
  memo: string | null
  updated_by: string | null
  updated_at: string | null
}

/** 보드 상호작용 모드 — 보기 / 문제 마킹 / 해결 마킹. */
export type BoardMode = 'view' | 'mark_problem' | 'mark_resolved'

export type SignalType =
  | 'speed_down'
  | 'break_needed'
  | 'question_surge'
  | 'practice_blocked'
  | 'lunch_delay'
  | 'network'
  | 'mood_drop'

export type SessionSignal = {
  id: string
  signal_type: SignalType
  note: string
  created_at: string
  acknowledged_at?: string | null
}

export type SeatmapResponse = {
  layout: {
    id: string
    session_id: string
    name: string
    layout: SeatLayoutConfig
  } | null
  marks: SeatMark[]
}
