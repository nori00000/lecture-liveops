import type { Session } from '@/lib/db/schema'
import type { LectureSessionMeta, MaterialVersion, RawNote, SessionDashboardPayload, StructuredObservation } from './types'
import { buildSituationSnapshot } from './snapshot'

export function sessionMeta(session: Session): LectureSessionMeta {
  const meta = session.metadata as LectureSessionMeta
  return {
    companyName: meta.companyName,
    category: meta.category,
    mainInstructor: meta.mainInstructor,
    assistants: Array.isArray(meta.assistants) ? meta.assistants : [],
    facilitators: Array.isArray(meta.facilitators) ? meta.facilitators : [],
    currentPhase: meta.currentPhase,
    statusLabel: meta.statusLabel,
    liveStartedAt: meta.liveStartedAt,
    liveEndedAt: meta.liveEndedAt,
    program: Array.isArray(meta.program)
      ? meta.program.filter((p) => p && typeof p.time === 'string' && typeof p.title === 'string')
      : undefined
  }
}

export function buildSessionDashboard(input: {
  session: Session
  rawNotes: RawNote[]
  observations: StructuredObservation[]
  materials: MaterialVersion[]
  now: string
}): SessionDashboardPayload {
  const meta = sessionMeta(input.session)
  const observationKeys = new Set(input.observations.map((o) => o.raw_note_id ?? o.id))
  const rawFallbacks = input.rawNotes
    .filter((note) => !observationKeys.has(note.id))
    .map(rawNoteToObservation)
  const timelineObservations = [...input.observations, ...rawFallbacks]
  return {
    ok: true,
    session: input.session,
    meta,
    rawNotes: [...input.rawNotes].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    observations: [...timelineObservations].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    materials: [...input.materials].sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    snapshot: buildSituationSnapshot({
      sessionId: input.session.id,
      currentPhase: meta.currentPhase,
      observations: timelineObservations,
      materials: input.materials,
      generatedAt: input.now
    })
  }
}

function rawNoteToObservation(note: RawNote): StructuredObservation {
  return {
    id: note.id,
    session_id: note.session_id,
    category: rawNoteCategory(note.raw_text),
    severity: rawNoteSeverity(note.raw_text),
    visibility: 'private',
    summary: note.raw_text,
    confidence: 1,
    created_at: note.created_at
  }
}

function rawNoteCategory(text: string): StructuredObservation['category'] {
  if (/질문|답변|qna/i.test(text)) return 'question'
  if (/오류|문제|이슈|막힘|해결/i.test(text)) return 'error'
  if (/쉬는|휴식|속도|진행/i.test(text)) return 'progress'
  return 'action'
}

function rawNoteSeverity(text: string): StructuredObservation['severity'] {
  if (/긴급|중단|전체|장애|블로커/i.test(text)) return 'high'
  if (/오류|문제|이슈|막힘/i.test(text)) return 'medium'
  return 'low'
}
