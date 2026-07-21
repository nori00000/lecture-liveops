import { z } from 'zod'

const id = z.string().min(1)
const ts = z.string()

export const VisibilityEnum = z.enum(['public', 'session', 'private', 'admin_only'])
export const RoleEnum = z.enum(['admin', 'instructor', 'assistant', 'participant'])
export const ActorTypeEnum = z.enum(['human', 'llm', 'system'])
export const ToolEnum = z.enum(['claude-code', 'codex', 'opencode', 'mcp', 'web-ui'])
export const SessionModeEnum = z.enum(['prep', 'live', 'after', 'archived'])
export const ObservationCategoryEnum = z.enum([
  'mood',
  'question',
  'answer',
  'error',
  'cause',
  'solution',
  'lecture_speed',
  'material',
  'action',
  'followup',
  'progress',
  'signal'
])
export const MoodLevelEnum = z.enum(['good', 'engaged', 'confused', 'stalled', 'tired'])
export const LectureSpeedEnum = z.enum(['slow', 'normal', 'fast'])
export const ObservationSeverityEnum = z.enum(['low', 'medium', 'high', 'urgent'])
export const MaterialStatusEnum = z.enum(['draft', 'review', 'shared', 'archived'])
export const MaterialAudienceEnum = z.enum(['instructors', 'assistants', 'participants', 'all'])

export const CompanySchema = z.object({
  id,
  name: z.string(),
  slug: z.string(),
  visibility: VisibilityEnum.default('private'),
  retention_policy: z.string().default('30d'),
  created_at: ts
})

export const CourseSchema = z.object({
  id,
  company_id: id,
  title: z.string(),
  description: z.string().default(''),
  default_venue: z.string().default(''),
  status: z.enum(['draft', 'active', 'archived']).default('active'),
  created_at: ts
})

export const SessionSchema = z.object({
  id,
  company_id: id,
  course_id: id,
  date: z.string(),
  title: z.string(),
  venue: z.string().default(''),
  mode: SessionModeEnum.default('prep'),
  private_by_default: z.boolean().default(true),
  metadata: z.record(z.unknown()).default({}),
  created_at: ts
})

export const AccessKeySchema = z.object({
  id,
  session_id: id,
  role: RoleEnum,
  key_hash: z.string(),
  expires_at: ts,
  revoked_at: ts.nullable().default(null),
  scope: z.record(z.unknown()).default({})
})

export const QnaStatusEnum = z.enum([
  'new',
  'triaged',
  'answered',
  'needs_follow_up',
  'sent_to_company',
  'archived'
])
export const QnaSchema = z.object({
  id,
  session_id: id,
  body: z.string(),
  body_redacted: z.string().default(''),
  answer: z.string().nullable().default(null),
  status: QnaStatusEnum.default('new'),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  tags: z.array(z.string()).default([]),
  visibility: VisibilityEnum.default('session'),
  created_by_role: RoleEnum,
  created_at: ts,
  updated_at: ts
})

export const PracticeStatusEnum = z.enum(['help_needed', 'assisting', 'solved', 'follow_up'])
export const PracticeTicketSchema = z.object({
  id,
  session_id: id,
  table_label: z.string().default(''),
  body: z.string(),
  status: PracticeStatusEnum.default('help_needed'),
  severity: z.enum(['low', 'normal', 'high', 'blocker']).default('normal'),
  assigned_assistant_id: z.string().nullable().default(null),
  created_at: ts,
  updated_at: ts
})

export const ResourceTypeEnum = z.enum([
  'pdf',
  'md',
  'xlsx',
  'image',
  'link',
  'html',
  'prompt',
  'code'
])
export const ResourceSchema = z.object({
  id,
  session_id: id,
  type: ResourceTypeEnum,
  title: z.string(),
  url_or_storage_path: z.string(),
  visibility: VisibilityEnum.default('session'),
  stage_tags: z.array(z.string()).default([]),
  audience_tags: z.array(z.string()).default([]),
  created_at: ts
})

export const OpsLogTypeEnum = z.enum([
  'issue',
  'mood',
  'signal',
  'question',
  'progress',
  'resource',
  'note'
])
export const OpsLogSchema = z.object({
  id,
  session_id: id,
  type: OpsLogTypeEnum,
  body: z.string(),
  visibility: VisibilityEnum.default('private'),
  created_by_role: RoleEnum,
  created_at: ts
})

export const SignalTypeEnum = z.enum([
  'speed_down',
  'break_needed',
  'question_surge',
  'practice_blocked',
  'lunch_delay',
  'network',
  'mood_drop'
])
export const AssistantSignalSchema = z.object({
  id,
  session_id: id,
  signal_type: SignalTypeEnum,
  table_label: z.string().default(''),
  note: z.string().default(''),
  acknowledged_at: ts.nullable().default(null),
  created_at: ts
})

export const TableProgressEnum = z.enum(['not_started', 'following', 'blocked', 'solved', 'waiting'])
export const TableStatusSchema = z.object({
  id,
  session_id: id,
  table_label: z.string(),
  progress: TableProgressEnum.default('not_started'),
  blocker: z.string().default(''),
  assistant_id: z.string().nullable().default(null),
  updated_at: ts
})

// ============================================================
// 좌석 신호등 보드 (seat traffic-light board)
// ============================================================
export const SeatStatusEnum = z.enum(['none', 'problem', 'resolved'])

export const SeatLayoutZoneSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['screen', 'desk']),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number()
})

export const SeatLayoutTableSchema = z.object({
  label: z.string(),
  // round: r + seats.angleDeg(극좌표) / rect: w·h / tshape: 가로 bar(w·h)+세로 stem(stemW·stemH, ⊥ 모양) — rect/tshape 좌석은 ox·oy(중심 오프셋)
  kind: z.enum(['round', 'rect', 'tshape']).default('round'),
  cx: z.number(),
  cy: z.number(),
  r: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
  stemW: z.number().optional(),
  stemH: z.number().optional(),
  seats: z.array(
    z.object({
      key: z.string(),
      angleDeg: z.number().optional(),
      ox: z.number().optional(),
      oy: z.number().optional()
    })
  ),
  roster: z.array(z.string()).optional()
})

// 좌표는 0~100 viewBox 단위
export const SeatLayoutConfigSchema = z.object({
  zones: z.array(SeatLayoutZoneSchema),
  tables: z.array(SeatLayoutTableSchema)
})

// 세션당 active 1개 (session_id unique upsert)
export const SeatLayoutSchema = z.object({
  id,
  session_id: id,
  name: z.string(),
  layout: SeatLayoutConfigSchema,
  created_at: ts,
  updated_at: ts
})

// unique(session_id, seat_key) upsert
export const SeatMarkSchema = z.object({
  id,
  session_id: id,
  seat_key: z.string(),
  status: SeatStatusEnum.default('none'),
  reason: z.string().default(''),
  memo: z.string().default(''),
  updated_by: z.string().default(''),
  updated_at: ts
})

export const SeatLayoutTemplateSchema = z.object({
  id,
  slug: z.string(),
  name: z.string(),
  description: z.string().default(''),
  layout: SeatLayoutConfigSchema,
  created_at: ts,
  updated_at: ts
})

export const ExcelTemplateSchema = z.object({
  id,
  session_id: id,
  title: z.string(),
  version: z.number().int().default(1),
  source_resource_id: z.string().nullable().default(null),
  schema_json: z.record(z.unknown()).default({}),
  created_at: ts
})

export const ExcelCellSchema = z.object({
  id,
  template_id: id,
  sheet_name: z.string().default('Sheet1'),
  cell_ref: z.string(),
  value: z.string().default(''),
  formula: z.string().default(''),
  updated_by: z.string().default(''),
  updated_at: ts
})

export const ExportProfileEnum = z.enum([
  'internal_retro',
  'company_deliverable',
  'participant_share',
  'markdown_archive'
])
export const ExportFormatEnum = z.enum(['md', 'xlsx', 'pdf', 'html', 'image', 'link'])
export const ExportJobSchema = z.object({
  id,
  session_id: id,
  profile: ExportProfileEnum,
  formats: z.array(ExportFormatEnum),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'blocked']).default('queued'),
  output_paths: z.record(z.unknown()).default({}),
  created_at: ts
})

export const ExternalArchiveSchema = z.object({
  id,
  session_id: id,
  target_path: z.string(),
  status: z.enum(['planned', 'dry_run', 'applied', 'blocked']).default('planned'),
  frontmatter: z.record(z.unknown()).default({}),
  created_at: ts
})

export const LiveObservationSchema = z.object({
  id,
  session_id: id,
  raw_note_id: z.string().optional(),
  category: ObservationCategoryEnum,
  time_label: z.string().optional(),
  target: z.string().optional(),
  mood: MoodLevelEnum.optional(),
  lecture_speed: LectureSpeedEnum.optional(),
  severity: ObservationSeverityEnum.default('low'),
  question: z.string().optional(),
  answer: z.string().optional(),
  issue: z.string().optional(),
  cause: z.string().optional(),
  solution: z.string().optional(),
  action_required: z.string().optional(),
  material_title: z.string().optional(),
  visibility: VisibilityEnum.default('session'),
  summary: z.string(),
  confidence: z.number().min(0).max(1).default(0.7),
  image_data: z.string().optional(),
  audience: z.enum(['main', 'assistant', 'both']).optional(),
  // 해결완료 플래그 — '해결'(solution 카테고리 content)과 구분. 해결 버튼으로만 true 가 된다.
  resolved: z.boolean().optional(),
  created_at: ts
})

export const SituationSnapshotSchema = z.object({
  session_id: id,
  generated_at: ts,
  current_phase: z.string(),
  risk_level: z.enum(['green', 'yellow', 'red']),
  mood_summary: z.string(),
  lecture_speed: LectureSpeedEnum,
  question_load: z.enum(['low', 'medium', 'high']),
  blocker_summary: z.string(),
  material_summary: z.string(),
  ai_summary: z.string(),
  suggested_main_instructor_actions: z.array(z.string()).default([]),
  suggested_assistant_actions: z.array(z.string()).default([]),
  unresolved_targets: z.array(z.string()).default([])
})

export const MaterialVersionSchema = z.object({
  id,
  session_id: id,
  resource_id: z.string().optional(),
  title: z.string(),
  type: ResourceTypeEnum,
  url_or_storage_path: z.string(),
  status: MaterialStatusEnum.default('draft'),
  audience: MaterialAudienceEnum.default('all'),
  version: z.number().int().default(1),
  latest_change_summary: z.string().optional(),
  updated_by: z.string().optional(),
  updated_at: ts
})

// ============================================================
// 숙의 도메인 코어 (deliberation core) — PRODUCT-PLAN-v2 §3
// ============================================================
export const RoundModeEnum = z.enum(['plenary', 'breakout'])
export const RoundStatusEnum = z.enum(['pending', 'active', 'closed'])
export const StatementVisibilityEnum = z.enum(['public', 'group', 'private'])
export const ModerationStateEnum = z.enum(['visible', 'flagged', 'hidden'])
export const VoteValueEnum = z.enum(['agree', 'disagree', 'pass'])
export const ModerationActionEnum = z.enum(['flag', 'hide', 'restore', 'approve'])

export const ParticipantSchema = z.object({
  id,
  session_id: id,
  display_alias: z.string().default(''),
  anon_handle: z.string().default(''),
  access_key_id: z.string().nullable().default(null),
  created_at: ts
})

export const WorkshopGroupSchema = z.object({
  id,
  session_id: id,
  label: z.string(),
  topic: z.string().default('')
})

export const GroupMembershipSchema = z.object({
  id,
  participant_id: id,
  group_id: id,
  created_at: ts
})

export const WorkshopRoundSchema = z.object({
  id,
  session_id: id,
  round_index: z.number().int(),
  title: z.string().default(''),
  mode: RoundModeEnum.default('plenary'),
  status: RoundStatusEnum.default('pending'),
  created_at: ts
})

export const StatementSchema = z.object({
  id,
  session_id: id,
  round_id: z.string().nullable().default(null),
  group_id: z.string().nullable().default(null),
  author_participant_id: z.string().nullable().default(null),
  body: z.string(),
  visibility: StatementVisibilityEnum.default('group'),
  moderation_state: ModerationStateEnum.default('visible'),
  created_at: ts
})

export const StatementVoteSchema = z.object({
  id,
  statement_id: id,
  participant_id: id,
  vote: VoteValueEnum,
  created_at: ts
})

export const LandscapeSnapshotSchema = z.object({
  id,
  session_id: id,
  round_id: z.string().nullable().default(null),
  computed_at: ts,
  payload: z.record(z.unknown()).default({}),
  published_at: ts.nullable().default(null)
})

export const ModerationEventSchema = z.object({
  id,
  statement_id: id,
  actor_role: RoleEnum,
  action: ModerationActionEnum,
  reason: z.string().default(''),
  created_at: ts
})

export const ActionLedgerSchema = z.object({
  id,
  session_id: z.string().nullable().default(null),
  actor_type: ActorTypeEnum,
  actor_role: RoleEnum,
  tool: ToolEnum.default('web-ui'),
  action_name: z.string(),
  input_hash: z.string(),
  input_redacted_summary: z.string(),
  output_summary: z.string().default(''),
  status: z.enum(['ok', 'denied', 'invalid', 'blocked', 'error', 'dry_run', 'cached']),
  created_at: ts
})

export type Company = z.infer<typeof CompanySchema>
export type Course = z.infer<typeof CourseSchema>
export type Session = z.infer<typeof SessionSchema>
export type AccessKey = z.infer<typeof AccessKeySchema>
export type Qna = z.infer<typeof QnaSchema>
export type PracticeTicket = z.infer<typeof PracticeTicketSchema>
export type Resource = z.infer<typeof ResourceSchema>
export type OpsLog = z.infer<typeof OpsLogSchema>
export type AssistantSignal = z.infer<typeof AssistantSignalSchema>
export type TableStatus = z.infer<typeof TableStatusSchema>
export type SeatStatus = z.infer<typeof SeatStatusEnum>
export type SeatLayoutConfig = z.infer<typeof SeatLayoutConfigSchema>
export type SeatLayout = z.infer<typeof SeatLayoutSchema>
export type SeatMark = z.infer<typeof SeatMarkSchema>
export type SeatLayoutTemplate = z.infer<typeof SeatLayoutTemplateSchema>

export type ExcelTemplate = z.infer<typeof ExcelTemplateSchema>
export type ExcelCell = z.infer<typeof ExcelCellSchema>
export type ExportJob = z.infer<typeof ExportJobSchema>
export type ExternalArchive = z.infer<typeof ExternalArchiveSchema>
export type LiveObservation = z.infer<typeof LiveObservationSchema>
export type SituationSnapshotRow = z.infer<typeof SituationSnapshotSchema>
export type MaterialVersionRow = z.infer<typeof MaterialVersionSchema>
export type ActionLedger = z.infer<typeof ActionLedgerSchema>

export type Participant = z.infer<typeof ParticipantSchema>
export type WorkshopGroup = z.infer<typeof WorkshopGroupSchema>
export type GroupMembership = z.infer<typeof GroupMembershipSchema>
export type WorkshopRound = z.infer<typeof WorkshopRoundSchema>
export type Statement = z.infer<typeof StatementSchema>
export type StatementVote = z.infer<typeof StatementVoteSchema>
export type LandscapeSnapshot = z.infer<typeof LandscapeSnapshotSchema>
export type ModerationEvent = z.infer<typeof ModerationEventSchema>
export type RoundMode = z.infer<typeof RoundModeEnum>
export type RoundStatus = z.infer<typeof RoundStatusEnum>
export type StatementVisibility = z.infer<typeof StatementVisibilityEnum>
export type ModerationState = z.infer<typeof ModerationStateEnum>
export type VoteValue = z.infer<typeof VoteValueEnum>
export type ModerationAction = z.infer<typeof ModerationActionEnum>

export type Role = z.infer<typeof RoleEnum>
export type Visibility = z.infer<typeof VisibilityEnum>
