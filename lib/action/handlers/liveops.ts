import { z } from 'zod'
import { ObservationCategoryEnum, ObservationSeverityEnum } from '@/lib/db/schema'
import { sessions, observations, materialVersions, opsLogs, companies, courses } from '@/lib/db/repo'
import { adminContext, type RlsContext } from '@/lib/db/neonHelpers'
import { newId, nowIso } from '@/lib/util/id'
import { parseRawNote } from '@/lib/liveops/parser'
import { buildSessionDashboard, sessionMeta } from '@/lib/liveops/dashboard'
import { buildSituationSnapshot } from '@/lib/liveops/snapshot'
import type { Handler } from './types'

const CreateLectureSessionInput = z.object({
  // companyId/courseId는 선택 — 미지정 시 companyName/category로 실제 회사·강좌를 찾거나 생성한다.
  // (과거 default('co-001-DEMO')가 모든 세션을 DEMO 회사로 연결시켜 MD export를 오염시킨 버그를 제거)
  companyId: z.string().optional(),
  courseId: z.string().optional(),
  companyName: z.string().min(1, '기업명을 입력하세요'),
  title: z.string().min(1),
  date: z.string().min(8),
  venue: z.string().default(''),
  category: z.string().default('기업 AX 교육'),
  mainInstructor: z.string().default('메인 강사'),
  assistants: z.array(z.string()).default([]),
  facilitators: z.array(z.string()).default([]),
  currentPhase: z.string().default('강의 준비')
})

const IngestRawNoteInput = z.object({
  sessionId: z.string().min(1),
  rawText: z.string().min(1),
  source: z.enum(['web', 'claude-code', 'codex', 'opencode', 'mcp', 'cli']).default('web'),
  visibility: z.enum(['public', 'session', 'private', 'admin_only']).default('private'),
  // 운영자가 카테고리를 직접 지정하면 자동 분류(parseRawNote)를 덮어쓴다. (오분류 교정)
  category: ObservationCategoryEnum.optional(),
  // 우선순위 — 메인강사 주목=urgent, 보조강사 우선=high 등. 지정 시 자동 severity 덮어씀.
  severity: ObservationSeverityEnum.optional(),
  // 스크린샷(클라이언트에서 리사이즈한 base64 data URL, ~수십KB). 단일 호환 유지.
  imageData: z.string().max(900_000).optional(),
  // 다중 스크린샷 — 여러 장을 한 번에. image_data 컬럼에 JSON 배열로 저장된다.
  images: z.array(z.string().max(900_000)).max(8).optional(),
  // 대상 태그 — 메인강사/보조강사 둘 다 알아야 하면 'both'
  audience: z.enum(['main', 'assistant', 'both']).optional(),
  // 빠른입력 질문/답변 모드 — 두 칸을 명시적으로 받아 파서를 거치지 않고 그대로 Q/A 컬럼에 저장.
  // (rawText에 '질문:/답변:' 라벨을 끼워넣어 분리하던 방식의 라벨 누수를 제거)
  question: z.string().max(2000).optional(),
  answer: z.string().max(4000).optional(),
  // 빠른입력 오류/해결 모드 — 두 칸을 명시 필드로 받아 파서 없이 issue/solution 컬럼에 저장(Q/A와 동일 방식).
  issue: z.string().max(2000).optional(),
  solution: z.string().max(4000).optional()
})

const SessionIdInput = z.object({ sessionId: z.string().min(1) })
const UpdatePhaseInput = SessionIdInput.extend({ currentPhase: z.string().min(1) })
const MaterialInput = SessionIdInput.extend({
  title: z.string().min(1),
  type: z.enum(['pdf', 'md', 'xlsx', 'image', 'link', 'html', 'prompt', 'code']).default('link'),
  urlOrStoragePath: z.string().min(1),
  status: z.enum(['draft', 'review', 'shared', 'archived']).default('draft'),
  audience: z.enum(['instructors', 'assistants', 'participants', 'all']).default('all'),
  latestChangeSummary: z.string().optional()
})

export const createLectureSession: Handler = async ({ envelope }) => {
  const input = CreateLectureSessionInput.parse(envelope.input)
  const ctx = adminContext()
  // 실제 회사·강좌에 연결 (없으면 생성). DEMO 회사/강좌에는 절대 연결하지 않는다.
  const companyId = await resolveCompanyId(ctx, input.companyId, input.companyName)
  const courseId = await resolveCourseId(ctx, input.courseId, companyId, input.category, input.venue)
  const row = await sessions.insert(ctx, {
    company_id: companyId,
    course_id: courseId,
    date: input.date,
    title: input.title,
    venue: input.venue,
    mode: 'live',
    private_by_default: true,
    metadata: {
      companyName: input.companyName,
      category: input.category,
      mainInstructor: input.mainInstructor,
      assistants: input.assistants,
      facilitators: input.facilitators,
      currentPhase: input.currentPhase,
      statusLabel: 'live',
      liveStartedAt: nowIso()
    }
  })
  return { ok: true, status: 'ok', data: row, summary: `lecture session created: ${row.id}` }
}

export const ingestRawNote: Handler = async ({ envelope }) => {
  const input = IngestRawNoteInput.parse(envelope.input)
  const createdAt = nowIso()
  const raw = await opsLogs.insert(adminContext(input.sessionId), {
    session_id: input.sessionId,
    type: 'note',
    body: input.rawText,
    visibility: input.visibility,
    created_by_role: envelope.actor.role
  })
  const parsed = parseRawNote({
    id: newId('ob'),
    sessionId: input.sessionId,
    rawText: input.rawText,
    visibility: input.visibility,
    createdAt
  })
  // 수동 카테고리 지정 시 자동 분류를 덮어쓴다. error가 아닌 카테고리로 지정하면 severity도 낮춘다
  // (예: 진행 상황인데 '문제·로그인' 단어 때문에 error/high로 잘못 분류되던 것 교정).
  // 명시적 질문/답변(빠른입력 Q/A 모드)은 파서보다 우선 — 원문 그대로 Q/A 컬럼에 저장한다.
  // 타임라인은 question·answer가 둘 다 있으면 'Q. / A.'로 렌더하므로 '질문:/답변:' 라벨 누수가 없다.
  const explicitQna = typeof input.question === 'string' && input.question.trim().length > 0
  const explicitIssueSol = !explicitQna && typeof input.issue === 'string' && input.issue.trim().length > 0
  const qText = explicitQna ? input.question!.trim() : undefined
  const aText = input.answer?.trim() || undefined
  const iText = explicitIssueSol ? input.issue!.trim() : undefined
  const sText = input.solution?.trim() || undefined
  const category =
    input.category ??
    (explicitQna
      ? aText ? 'answer' : 'question'
      : explicitIssueSol
        ? sText ? 'solution' : 'error'
        : parsed.category)
  const severity = input.severity ?? (input.category && input.category !== 'error' ? 'low' : parsed.severity)
  // 수동 카테고리 지정 시, 그 카테고리와 무관한 구조화 추출은 버린다 ('분위기' 오분류 방지).
  // 명시적 Q/A · 오류/해결은 파서보다 우선 — 원문 그대로 해당 컬럼에 저장(라벨 누수 없음).
  const structured = explicitQna
    ? { question: qText, answer: aText, issue: undefined, solution: undefined }
    : explicitIssueSol
      ? { question: undefined, answer: undefined, issue: iText, solution: sText }
      : input.category
        ? {
            question: category === 'question' || category === 'answer' ? parsed.question : undefined,
            answer: category === 'answer' ? parsed.answer : undefined,
            issue: category === 'error' || category === 'solution' ? parsed.issue : undefined,
            solution: category === 'solution' ? parsed.solution : undefined
          }
        : null
  const summary = explicitQna
    ? (aText ? `${qText} → ${aText}` : qText!)
    : explicitIssueSol
      ? (sText ? `${iText} → ${sText}` : iText!)
      : parsed.summary
  // 다중 이미지는 JSON 배열로, 단일은 기존 그대로 저장(레거시 호환). 리더가 둘 다 파싱한다.
  const imageData = input.images?.length ? JSON.stringify(input.images) : input.imageData
  const observation = await observations.insert({
    ...parsed,
    ...(structured ?? {}),
    category,
    severity,
    summary,
    raw_note_id: raw.id,
    image_data: imageData,
    audience: input.audience
  })
  const dashboard = await buildDashboard(input.sessionId)
  return { ok: true, status: 'ok', data: { raw, observation, snapshot: dashboard?.snapshot }, summary: observation.summary }
}

export const generateSituationSnapshot: Handler = async ({ envelope }) => {
  const input = SessionIdInput.parse(envelope.input)
  const dashboard = await buildDashboard(input.sessionId)
  return { ok: true, status: 'ok', data: dashboard?.snapshot, summary: 'situation snapshot generated' }
}

const DeleteObservationInput = SessionIdInput.extend({ observationId: z.string().min(1) })

// 상황판 관찰 로그 1건 삭제 (운영자가 오등록/불필요 항목을 직접 정리).
export const deleteObservation: Handler = async ({ envelope }) => {
  const input = DeleteObservationInput.parse(envelope.input)
  await observations.delete(input.observationId, adminContext(input.sessionId))
  return { ok: true, status: 'ok', data: { deleted: input.observationId }, summary: `observation deleted: ${input.observationId}` }
}

// 관찰 로그 항목 해결 처리 — 누르면 solution(초록) + severity low.
export const resolveObservation: Handler = async ({ envelope }) => {
  const input = DeleteObservationInput.parse(envelope.input)
  await observations.resolve(input.observationId, adminContext(input.sessionId))
  return { ok: true, status: 'ok', data: { resolved: input.observationId }, summary: `observation resolved: ${input.observationId}` }
}

const UpdateObservationInput = DeleteObservationInput.extend({
  summary: z.string().min(1),
  question: z.string().optional(),
  answer: z.string().optional(),
  issue: z.string().optional(),
  solution: z.string().optional(),
  // 수정 시 이미지 전체 교체(추가/삭제 반영). 미지정=이미지 유지, []=전체 삭제.
  images: z.array(z.string().max(900_000)).max(8).optional()
})

// 관찰 로그 텍스트 수정 — 원문(summary)과 질문/답변·오류/해결 + 이미지 교정.
export const updateObservation: Handler = async ({ envelope }) => {
  const input = UpdateObservationInput.parse(envelope.input)
  // images 미지정이면 이미지 미변경(undefined), 빈 배열이면 삭제(null), 있으면 JSON 배열로 저장.
  const imageData = input.images !== undefined ? (input.images.length ? JSON.stringify(input.images) : null) : undefined
  await observations.update(
    input.observationId,
    { summary: input.summary, question: input.question, answer: input.answer, issue: input.issue, solution: input.solution, imageData },
    adminContext(input.sessionId)
  )
  return { ok: true, status: 'ok', data: { updated: input.observationId }, summary: `observation updated: ${input.observationId}` }
}

export const updateSessionPhase: Handler = async ({ envelope }) => {
  const input = UpdatePhaseInput.parse(envelope.input)
  const session = await sessions.findById(adminContext(input.sessionId), input.sessionId)
  if (!session) return { ok: false, status: 'invalid', error: 'session not found' }
  const updated = await sessions.updateMetadata(adminContext(input.sessionId), input.sessionId, {
    ...session.metadata,
    currentPhase: input.currentPhase
  })
  return { ok: true, status: 'ok', data: updated, summary: `phase updated: ${input.currentPhase}` }
}

// 교육 종료 — 세션을 archived로 내린다. 삭제가 아니라 보관: 데이터는 그대로 남고
// 아카이브 페이지에서 타임라인·MD Export로 조회된다. getToday는 archived를 today 후보에서
// 제외하므로(exact 매칭의 mode!='archived') 종료하면 상황판이 다음 세션으로 넘어간다.
export const endSession: Handler = async ({ envelope }) => {
  const input = SessionIdInput.parse(envelope.input)
  const ctx = adminContext(input.sessionId)
  const session = await sessions.findById(ctx, input.sessionId)
  if (!session) return { ok: false, status: 'invalid', error: 'session not found' }
  if (session.mode === 'archived') return { ok: true, status: 'ok', data: session, summary: 'already archived' }
  const updated = await sessions.updateMode(ctx, input.sessionId, 'archived')
  return { ok: true, status: 'ok', data: updated, summary: `session archived: ${input.sessionId}` }
}

export const upsertMaterialVersion: Handler = async ({ envelope }) => {
  const input = MaterialInput.parse(envelope.input)
  const row = await materialVersions.upsert({
    session_id: input.sessionId,
    title: input.title,
    type: input.type,
    url_or_storage_path: input.urlOrStoragePath,
    status: input.status,
    audience: input.audience,
    version: 1,
    latest_change_summary: input.latestChangeSummary,
    updated_by: envelope.actor.role
  })
  return { ok: true, status: 'ok', data: row, summary: `material ${row.status}: ${row.title}` }
}

export const listSessionDashboard: Handler = async ({ envelope }) => {
  const input = SessionIdInput.parse(envelope.input)
  const dashboard = await buildDashboard(input.sessionId)
  if (!dashboard) return { ok: false, status: 'invalid', error: 'session not found' }
  return { ok: true, status: 'ok', data: dashboard, summary: dashboard.snapshot.ai_summary }
}

async function buildDashboard(sessionId: string) {
  const session = await sessions.findById(adminContext(sessionId), sessionId)
  if (!session) return null
  const obs = await observations.listBySession(sessionId)
  const mats = await materialVersions.listBySession(sessionId)
  const ops = await opsLogs.list(adminContext(sessionId), sessionId)
  const rawNotes = ops.map((o) => ({
    id: o.id,
    session_id: o.session_id,
    raw_text: o.body,
    author_role: o.created_by_role,
    source: 'web' as const,
    created_at: o.created_at
  }))
  const dashboard = buildSessionDashboard({ session, rawNotes, observations: obs, materials: mats, now: nowIso() })
  await import('@/lib/db/repo').then(({ snapshots }) => snapshots.upsert(buildSituationSnapshot({
    sessionId,
    currentPhase: sessionMeta(session).currentPhase,
    observations: obs,
    materials: mats,
    generatedAt: dashboard.snapshot.generated_at
  })))
  return dashboard
}

const DEMO_SUFFIX = '-DEMO'

// 회사명으로 실제 회사를 찾고(이름 일치, DEMO 제외) 없으면 생성한다. 명시 companyId가 유효하면 우선.
async function resolveCompanyId(ctx: RlsContext, explicitId: string | undefined, name: string): Promise<string> {
  if (explicitId && !explicitId.endsWith(DEMO_SUFFIX)) {
    const found = await companies.findById(ctx, explicitId)
    if (found) return found.id
  }
  const match = (await companies.list(ctx)).find((c) => c.name === name && !c.id.endsWith(DEMO_SUFFIX))
  if (match) return match.id
  const created = await companies.insert(ctx, { name, slug: toSlug(name), visibility: 'private', retention_policy: '90d' })
  return created.id
}

// 카테고리(강좌명)로 회사 하위 강좌를 찾고 없으면 생성한다. 명시 courseId가 유효하면 우선.
async function resolveCourseId(ctx: RlsContext, explicitId: string | undefined, companyId: string, category: string, venue: string): Promise<string> {
  if (explicitId && !explicitId.endsWith(DEMO_SUFFIX)) {
    const found = await courses.findById(ctx, explicitId)
    if (found) return found.id
  }
  const match = (await courses.findByCompany(ctx, companyId)).find((c) => c.title === category && !c.id.endsWith(DEMO_SUFFIX))
  if (match) return match.id
  const created = await courses.insert(ctx, { company_id: companyId, title: category, description: '', default_venue: venue, status: 'active' })
  return created.id
}

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-+|-+$/g, '') || newId('co')
}
