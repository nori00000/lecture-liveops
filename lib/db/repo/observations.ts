import { getStore, bumpRevision } from '../fixture/store'
import { newId, nowIso } from '@/lib/util/id'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, adminContext, type RlsContext } from '../neonHelpers'
import type { LiveObservation } from '../schema'

type Row = Record<string, unknown>
const str = (v: unknown): string | undefined => (v != null && v !== '' ? String(v) : undefined)

function toObservation(r: Row): LiveObservation {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    raw_note_id: str(r.raw_note_id),
    category: r.category as LiveObservation['category'],
    time_label: str(r.time_label),
    target: str(r.target),
    mood: (str(r.mood) as LiveObservation['mood']) ?? undefined,
    lecture_speed: (str(r.lecture_speed) as LiveObservation['lecture_speed']) ?? undefined,
    severity: (r.severity as LiveObservation['severity']) ?? 'low',
    question: str(r.question),
    answer: str(r.answer),
    issue: str(r.issue),
    cause: str(r.cause),
    solution: str(r.solution),
    action_required: str(r.action_required),
    material_title: str(r.material_title),
    visibility: (r.visibility as LiveObservation['visibility']) ?? 'session',
    summary: String(r.summary),
    confidence: r.confidence != null ? Number(r.confidence) : 0.7,
    image_data: str(r.image_data),
    audience: str(r.audience) as LiveObservation['audience'],
    resolved: r.resolved === true,
    created_at: isoOrString(r.created_at)
  }
}

// COLS.live_observations 와 동일 순서의 23개 플레이스홀더
const LO_VALUES = '$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23'

export const observations = {
  // ctx 미지정 시 admin (server-internal). dashboard/route 가 sessionId 기반으로 호출한다.
  async listBySession(sessionId: string, ctx: RlsContext = adminContext(sessionId)): Promise<LiveObservation[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.live_observations} from live_observations where session_id = $1 order by created_at desc`, [sessionId])
      return rows.map(toObservation)
    }
    return [...getStore().live_observations]
      .filter((o) => o.session_id === sessionId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  },
  async insert(
    input: Omit<LiveObservation, 'id' | 'created_at'> & Partial<Pick<LiveObservation, 'id' | 'created_at'>>,
    ctx?: RlsContext
  ): Promise<LiveObservation> {
    const row: LiveObservation = {
      id: input.id ?? newId('ob'),
      session_id: input.session_id,
      raw_note_id: input.raw_note_id,
      category: input.category,
      time_label: input.time_label,
      target: input.target,
      mood: input.mood,
      lecture_speed: input.lecture_speed,
      severity: input.severity ?? 'low',
      question: input.question,
      answer: input.answer,
      issue: input.issue,
      cause: input.cause,
      solution: input.solution,
      action_required: input.action_required,
      material_title: input.material_title,
      visibility: input.visibility ?? 'session',
      summary: input.summary,
      confidence: input.confidence ?? 0.7,
      image_data: input.image_data,
      audience: input.audience,
      resolved: input.resolved ?? false,
      created_at: input.created_at ?? nowIso()
    }
    if (isNeonEnabled()) {
      await query(
        ctx ?? adminContext(row.session_id),
        `insert into live_observations (${COLS.live_observations}) values (${LO_VALUES})`,
        [
          row.id, row.session_id, row.raw_note_id ?? null, row.category, row.time_label ?? null,
          row.target ?? null, row.mood ?? null, row.lecture_speed ?? null, row.severity, row.question ?? null,
          row.answer ?? null, row.issue ?? null, row.cause ?? null, row.solution ?? null, row.action_required ?? null,
          row.material_title ?? null, row.visibility, row.summary, row.confidence, row.image_data ?? null,
          row.audience ?? null, row.resolved ?? false, row.created_at
        ]
      )
      return row
    }
    const s = getStore()
    s.live_observations = [...s.live_observations, row]
    bumpRevision()
    return row
  },
  async delete(id: string, ctx: RlsContext = adminContext()): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `delete from live_observations where id = $1`, [id])
      return
    }
    const s = getStore()
    s.live_observations = s.live_observations.filter((o) => o.id !== id)
    bumpRevision()
  },
  // 해결완료 처리 — resolved=true(연한 초록 '해결완료' 표시) + severity low. 원래 category는 보존한다
  // (오류였던 항목은 '오류 → 해결완료'로 읽히도록). '해결'(solution content)과는 별개 상태다.
  async resolve(id: string, ctx: RlsContext = adminContext()): Promise<void> {
    if (isNeonEnabled()) {
      await query(ctx, `update live_observations set resolved = true, severity = 'low' where id = $1`, [id])
      return
    }
    const s = getStore()
    s.live_observations = s.live_observations.map((o) =>
      o.id === id ? { ...o, resolved: true, severity: 'low' } : o
    )
    bumpRevision()
  },
  // 텍스트 수정 — summary(원문) + question/answer/issue/solution + 이미지(image_data) 교정.
  // patch.imageData: undefined=이미지 미변경, null=삭제, string=JSON 배열로 교체.
  async update(
    id: string,
    patch: { summary: string; question?: string; answer?: string; issue?: string; solution?: string; imageData?: string | null },
    ctx: RlsContext = adminContext()
  ): Promise<void> {
    if (isNeonEnabled()) {
      const sets = ['summary = $2', 'question = $3', 'answer = $4', 'issue = $5', 'solution = $6']
      const params: unknown[] = [id, patch.summary, patch.question ?? null, patch.answer ?? null, patch.issue ?? null, patch.solution ?? null]
      if (patch.imageData !== undefined) {
        params.push(patch.imageData)
        sets.push(`image_data = $${params.length}`)
      }
      await query(ctx, `update live_observations set ${sets.join(', ')} where id = $1`, params)
      return
    }
    const s = getStore()
    s.live_observations = s.live_observations.map((o) =>
      o.id === id
        ? {
            ...o,
            summary: patch.summary,
            question: patch.question,
            answer: patch.answer,
            issue: patch.issue,
            solution: patch.solution,
            ...(patch.imageData !== undefined ? { image_data: patch.imageData ?? undefined } : {})
          }
        : o
    )
    bumpRevision()
  }
}
