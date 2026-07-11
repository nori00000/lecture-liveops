import type { Role, Resource, Session, Visibility } from '@/lib/db/schema'

export type NoteSource = 'web' | 'claude-code' | 'codex' | 'opencode' | 'mcp' | 'cli'
export type ObservationCategory =
  | 'mood'
  | 'question'
  | 'answer'
  | 'error'
  | 'cause'
  | 'solution'
  | 'lecture_speed'
  | 'material'
  | 'action'
  | 'followup'
  | 'progress'
  | 'signal'

export type MoodLevel = 'good' | 'engaged' | 'confused' | 'stalled' | 'tired'
export type LectureSpeed = 'slow' | 'normal' | 'fast'
export type RiskLevel = 'green' | 'yellow' | 'red'
export type LoadLevel = 'low' | 'medium' | 'high'
export type ObservationSeverity = 'low' | 'medium' | 'high' | 'urgent'
export type MaterialStatus = 'draft' | 'review' | 'shared' | 'archived'
export type MaterialAudience = 'instructors' | 'assistants' | 'participants' | 'all'

export type LectureSessionMeta = {
  companyName?: string
  category?: string
  mainInstructor?: string
  assistants?: string[]
  facilitators?: string[]
  currentPhase?: string
  statusLabel?: string
  liveStartedAt?: string
  liveEndedAt?: string
  // 진행 순서(아젠다) — 화면에 표시하고 시간 경과에 따라 자동 체크한다. time은 "HH:MM-HH:MM".
  program?: { time: string; title: string }[]
}

export type RawNote = {
  id: string
  session_id: string
  raw_text: string
  author_role: Role
  source: NoteSource
  created_at: string
}

export type StructuredObservation = {
  id: string
  session_id: string
  raw_note_id?: string
  category: ObservationCategory
  time_label?: string
  target?: string
  mood?: MoodLevel
  lecture_speed?: LectureSpeed
  severity: ObservationSeverity
  question?: string
  answer?: string
  issue?: string
  cause?: string
  solution?: string
  action_required?: string
  material_title?: string
  visibility: Visibility
  summary: string
  confidence: number
  image_data?: string
  audience?: 'main' | 'assistant' | 'both'
  resolved?: boolean
  created_at: string
}

export type SituationSnapshot = {
  session_id: string
  generated_at: string
  current_phase: string
  risk_level: RiskLevel
  mood_summary: string
  lecture_speed: LectureSpeed
  question_load: LoadLevel
  blocker_summary: string
  material_summary: string
  ai_summary: string
  suggested_main_instructor_actions: string[]
  suggested_assistant_actions: string[]
  unresolved_targets: string[]
}

export type MaterialVersion = {
  id: string
  session_id: string
  resource_id?: string
  title: string
  type: Resource['type']
  url_or_storage_path: string
  status: MaterialStatus
  audience: MaterialAudience
  version: number
  latest_change_summary?: string
  updated_by?: string
  updated_at: string
}

export type SessionDashboardPayload = {
  ok: true
  session: Session
  meta: LectureSessionMeta
  snapshot: SituationSnapshot
  observations: StructuredObservation[]
  materials: MaterialVersion[]
  rawNotes: RawNote[]
}
