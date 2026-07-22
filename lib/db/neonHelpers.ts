// Lecture LiveOps — Neon helpers (P1-1: RLS context wrapper)
// 일반 요청은 anon role + JWT claim 주입 transaction으로 처리한다.
// owner role은 migration/probe meta 전용.

import { getNeonAnonSql, getNeonOwnerSql } from './neon'
import { normalizeRow, normalizeRows, type Row } from './rowUtil'

export type { Row } from './rowUtil'
export { normalizeRow, normalizeRows } from './rowUtil'

export type RlsRole = 'admin' | 'instructor' | 'assistant' | 'participant'

export type RlsContext = {
  role: RlsRole
  sessionId?: string
  sub?: string
  // 숙의 신원 — participant/group. route layer 가 서버 신뢰 경로(쿠키)에서만 주입한다.
  // RLS 의 liveops_participant_id()/liveops_group_id() 가 이 값을 읽어 visibility 판정.
  participantId?: string
  groupId?: string
}

// ctx → request.jwt.claims payload. participant/group 신원이 있으면 포함.
function claimsFor(ctx: RlsContext): string {
  const claims: Record<string, string> = { role: ctx.role, sub: ctx.sub ?? '' }
  if (ctx.participantId) claims.participant_id = ctx.participantId
  if (ctx.groupId) claims.group_id = ctx.groupId
  return JSON.stringify(claims)
}

// 모든 repo 함수가 받는 ctx. P1-1: actor가 명시되지 않으면 admin (server-internal) 처리.
// route layer는 envelope.actor.role + scope.sessionId 를 주입해야 한다.
export function adminContext(sessionId?: string): RlsContext {
  return { role: 'admin', sessionId }
}

// 일반 query: anon role + ctx 주입 transaction
export async function query<T extends Row = Row>(
  ctx: RlsContext,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const sql = getNeonAnonSql()
  const claims = claimsFor(ctx)
  const headers = JSON.stringify({ 'x-session-id': ctx.sessionId ?? '' })
  const res = await sql.transaction([
    sql`select set_config('request.jwt.claims', ${claims}, true)`,
    sql`select set_config('request.headers', ${headers}, true)`,
    sql.query(text, params as never[])
  ])
  const rows = (res[2] as Row[]) ?? []
  return normalizeRows<T>(rows)
}

export async function queryOne<T extends Row = Row>(
  ctx: RlsContext,
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(ctx, text, params)
  return rows[0]
}

// owner-level escape hatch (절대 일반 코드에서 사용 X — migration/probe 전용)
export async function queryOwner<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = getNeonOwnerSql()
  const res = await sql.query(text, params as never[])
  return normalizeRows<T>(res as Row[])
}

// P1-7: multi-step write 를 단일 BEGIN/COMMIT atomic transaction 으로 묶는다.
// neon-serverless 의 sql.transaction(array) 형식 사용.
//
// 호출자는 buildStatements 가 statements 배열을 반환하도록 한다.
// 모든 statement 가 성공해야 commit, 어느 하나라도 fail 하면 전체 rollback.
//
// 사용 예:
//   const [qnaRows, ledgerRows] = await withTxn<[QnaRow[], LedgerRow[]]>(ctx, (sql) => [
//     sql`insert into qna_items (...) values (...) returning *`,
//     sql`insert into action_ledger (...) values (...) returning *`,
//   ])
//
// 주의: array form 은 결과 chain 불가 (statement A 의 RETURNING id 를 statement B 에서 못 씀).
// chain 이 필요하면 PostgreSQL CTE (with ... insert ... select ...) 패턴 사용 또는
// 미리 id 를 newId() 로 생성하여 두 statement 모두에 주입.
import type { NeonQueryFunction } from '@neondatabase/serverless'

export async function withTxn<T extends Row[][] = Row[][]>(
  ctx: RlsContext,
  buildStatements: (sql: NeonQueryFunction<false, false>) => unknown[]
): Promise<T> {
  const sql = getNeonAnonSql()
  const claims = claimsFor(ctx)
  const headers = JSON.stringify({ 'x-session-id': ctx.sessionId ?? '' })
  const userStatements = buildStatements(sql)
  if (userStatements.length === 0) {
    throw new Error('withTxn: empty statements')
  }
  // set_config 2건 + 사용자 statements 묶음. 전부 한 트랜잭션 내에서 실행.
  const allStatements = [
    sql`select set_config('request.jwt.claims', ${claims}, true)`,
    sql`select set_config('request.headers', ${headers}, true)`,
    ...userStatements
  ] as unknown as Parameters<typeof sql.transaction>[0]
  const results = (await sql.transaction(allStatements)) as Row[][]
  // 첫 2건 (set_config) 제외하고 사용자 결과만 반환
  return results.slice(2) as T
}

export const COLS = {
  companies: 'id, name, slug, visibility, retention_policy, created_at',
  courses: 'id, company_id, title, description, default_venue, status, created_at',
  sessions: 'id, company_id, course_id, date, title, venue, mode, private_by_default, metadata, created_at',
  access_keys: 'id, session_id, role, key_hash, expires_at, revoked_at, scope',
  qna_items: 'id, session_id, body, body_redacted, answer, status, priority, tags, visibility, created_by_role, created_at, updated_at',
  practice_tickets: 'id, session_id, table_label, body, status, severity, assigned_assistant_id, created_at, updated_at',
  resources: 'id, session_id, type, title, url_or_storage_path, visibility, stage_tags, audience_tags, created_at',
  ops_logs: 'id, session_id, type, body, visibility, created_by_role, created_at',
  live_observations: 'id, session_id, raw_note_id, category, time_label, target, mood, lecture_speed, severity, question, answer, issue, cause, solution, action_required, material_title, visibility, summary, confidence, image_data, audience, resolved, created_at',
  assistant_signals: 'id, session_id, signal_type, table_label, note, acknowledged_at, created_at',
  table_statuses: 'id, session_id, table_label, progress, blocker, assistant_id, updated_at',
  seat_layouts: 'id, session_id, name, layout, created_at, updated_at',
  seat_layout_templates: 'id, slug, name, description, layout, created_at, updated_at',
  seat_marks: 'id, session_id, seat_key, status, reason, memo, updated_by, updated_at',
  excel_templates: 'id, session_id, title, version, source_resource_id, schema_json, created_at',
  excel_cells: 'id, template_id, sheet_name, cell_ref, value, formula, updated_by, updated_at',
  export_jobs: 'id, session_id, profile, formats, status, output_paths, created_at',
  external_archives: 'id, session_id, target_path, status, frontmatter, created_at',
  action_ledger: 'id, session_id, actor_type, actor_role, tool, action_name, input_hash, input_redacted_summary, output_summary, status, created_at',
  participants: 'id, session_id, display_alias, anon_handle, access_key_id, created_at',
  workshop_groups: 'id, session_id, label, topic',
  group_memberships: 'id, participant_id, group_id, created_at',
  workshop_rounds: 'id, session_id, round_index, title, mode, status, created_at',
  // evidence_kind 는 0018 에서 추가된 nullable 컬럼 (Q1 근거 유형 자기 태깅). 컬럼 순서 = insert 값 순서.
  statements: 'id, session_id, round_id, group_id, author_participant_id, body, visibility, moderation_state, created_at, evidence_kind',
  statement_votes: 'id, statement_id, participant_id, vote, created_at',
  landscape_snapshots: 'id, session_id, round_id, computed_at, payload, published_at',
  moderation_events: 'id, statement_id, actor_role, action, reason, created_at'
} as const

export function isoOrString(v: unknown): string {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') return v
  if (v == null) return ''
  return String(v)
}

export function dateOnly(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v.slice(0, 10)
  return ''
}
