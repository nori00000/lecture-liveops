// DEMO 데이터. 실제 기업명/사람 이름/Q&A 본문 0건. 모두 -DEMO 접미사.
// 3 company / 3 course / 5 session / 21 access_key / 50 qna / 30 practice /
// 100 ops_log / 15 signal / 30 table_status / 2 excel_template + 40 cells

import type {
  Company,
  Course,
  Session,
  AccessKey,
  Qna,
  PracticeTicket,
  Resource,
  OpsLog,
  AssistantSignal,
  TableStatus,
  ExcelTemplate,
  ExcelCell,
  SeatLayout,
  SeatMark,
  SeatLayoutTemplate
} from '../schema'
import { buildEightTeamSeatLayout, buildTshapeLayout, buildLectureT8SeatLayout } from '../../seatmap/layout'

const BASE = new Date('2026-05-27T09:00:00+09:00').getTime()
const iso = (offsetMs: number) => new Date(BASE + offsetMs).toISOString()
const NOW = iso(0)

// ============================================================
// companies (3)
// ============================================================
export const seedCompanies: Company[] = [
  { id: 'co-001-DEMO', name: '샘플 기관 A', slug: 'sample-org-a', visibility: 'private', retention_policy: '90d', created_at: NOW },
  { id: 'co-002-DEMO', name: '샘플 기관 B', slug: 'sample-org-b', visibility: 'private', retention_policy: '90d', created_at: NOW },
  { id: 'co-003-DEMO', name: '샘플 기관 C', slug: 'sample-org-c', visibility: 'private', retention_policy: '90d', created_at: NOW }
]

// ============================================================
// courses (3) — 회사별 1개
// ============================================================
export const seedCourses: Course[] = [
  { id: 'cr-001-DEMO', company_id: 'co-001-DEMO', title: '병원 AI Agent 실무 워크숍-DEMO', description: '실무자 대상 AI 에이전트 활용 (DEMO)', default_venue: '강의장 A-DEMO', status: 'active', created_at: NOW },
  { id: 'cr-002-DEMO', company_id: 'co-002-DEMO', title: '문서 자동화 워크숍', description: '반복 문서 흐름 자동화 실습', default_venue: '강의장 B-DEMO', status: 'active', created_at: NOW },
  { id: 'cr-003-DEMO', company_id: 'co-003-DEMO', title: '데이터 활용 워크숍', description: '샘플 데이터 분류 실습', default_venue: '강의장 C-DEMO', status: 'active', created_at: NOW }
]

// ============================================================
// sessions (5)
// ============================================================
export const seedSessions: Session[] = [
  { id: 'se-001-DEMO', company_id: 'co-001-DEMO', course_id: 'cr-001-DEMO', date: '2026-06-15', title: '오전 세션-DEMO', venue: '강의장 A-DEMO', mode: 'live', private_by_default: true, metadata: { capacity: 24, tables: 6 }, created_at: NOW },
  { id: 'se-002-DEMO', company_id: 'co-001-DEMO', course_id: 'cr-001-DEMO', date: '2026-06-20', title: '심화 세션-DEMO', venue: '강의장 A-DEMO', mode: 'prep', private_by_default: true, metadata: { capacity: 24, tables: 6 }, created_at: NOW },
  { id: 'se-003-DEMO', company_id: 'co-002-DEMO', course_id: 'cr-002-DEMO', date: '2026-06-25', title: '자동화 실습 1', venue: '강의장 B-DEMO', mode: 'prep', private_by_default: true, metadata: { capacity: 18, tables: 5 }, created_at: NOW },
  { id: 'se-004-DEMO', company_id: 'co-002-DEMO', course_id: 'cr-002-DEMO', date: '2026-07-01', title: '자동화 실습 2', venue: '강의장 B-DEMO', mode: 'prep', private_by_default: true, metadata: { capacity: 18, tables: 5 }, created_at: NOW },
  { id: 'se-005-DEMO', company_id: 'co-003-DEMO', course_id: 'cr-003-DEMO', date: '2026-07-08', title: '데이터 실습 1', venue: '강의장 C-DEMO', mode: 'prep', private_by_default: true, metadata: { capacity: 20, tables: 5 }, created_at: NOW }
]

// ============================================================
// access_keys (21) — 회사별 1 instructor + 2 assistant + 4 participant
// ============================================================
export const seedAccessKeys: AccessKey[] = (() => {
  const rows: AccessKey[] = []
  const expires = '2026-12-31T23:59:00+09:00'
  let n = 1
  for (const s of seedSessions) {
    if (s.id === 'se-001-DEMO' || s.id === 'se-003-DEMO' || s.id === 'se-005-DEMO') {
      // 첫 세션마다 1 instr + 2 assist + 4 part
      rows.push({ id: `ak-${String(n++).padStart(3, '0')}-DEMO`, session_id: s.id, role: 'instructor', key_hash: `demo-hash-${s.id}-inst`, expires_at: expires, revoked_at: null, scope: {} })
      for (let i = 1; i <= 2; i++) rows.push({ id: `ak-${String(n++).padStart(3, '0')}-DEMO`, session_id: s.id, role: 'assistant', key_hash: `demo-hash-${s.id}-asst-${i}`, expires_at: expires, revoked_at: null, scope: {} })
      for (let i = 1; i <= 4; i++) rows.push({ id: `ak-${String(n++).padStart(3, '0')}-DEMO`, session_id: s.id, role: 'participant', key_hash: `demo-hash-${s.id}-part-${i}`, expires_at: expires, revoked_at: null, scope: { pool: true } })
    }
  }
  return rows
})()

// ============================================================
// qna (50) — se-001 30건 + se-003 12건 + se-005 8건
// ============================================================
const QNA_BODIES = [
  '프롬프트 작성 기본 패턴이 궁금합니다',
  '에이전트가 회신을 못할 때 처리법',
  '실습 단계가 막혔습니다',
  '보안 가이드라인이 있나요',
  '교육 자료 다운로드 위치',
  '업무 자동화 추천 도구',
  '데이터 마스킹 체크리스트',
  'Markdown 표 작성 팁',
  '엔터프라이즈 보안 대응',
  '미답 질문 follow-up 방식',
  '실습 산출물 양식',
  '세션 종료 후 자료 공유',
  '권한 관리 베스트 프랙티스',
  '한글 토큰 카운팅 방법',
  '문서 자동 요약 사례',
  '이미지 OCR 정확도',
  'API 호출 비용 절감',
  'A/B 테스트 절차',
  '모델 선택 기준',
  '캐싱 정책 추천'
]
const QNA_STATUSES: Qna['status'][] = ['new', 'triaged', 'answered', 'needs_follow_up', 'sent_to_company']
const QNA_PRIORITIES: Qna['priority'][] = ['low', 'normal', 'high']

export const seedQna: Qna[] = (() => {
  const rows: Qna[] = []
  const assignments: Array<[string, number]> = [['se-001-DEMO', 30], ['se-003-DEMO', 12], ['se-005-DEMO', 8]]
  let i = 1
  for (const [sid, count] of assignments) {
    for (let k = 0; k < count; k++) {
      const status = QNA_STATUSES[k % QNA_STATUSES.length]
      const body = `${QNA_BODIES[k % QNA_BODIES.length]} (DEMO #${k + 1})`
      rows.push({
        id: `qn-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        body,
        body_redacted: body.slice(0, 80),
        answer: status === 'answered' || status === 'sent_to_company' ? `답변 (DEMO #${k + 1})` : null,
        status,
        priority: QNA_PRIORITIES[k % 3],
        tags: ['demo'],
        visibility: 'session',
        created_by_role: 'participant',
        created_at: iso(k * 60_000),
        updated_at: iso(k * 60_000)
      })
    }
  }
  return rows
})()

// ============================================================
// practice (30) — se-001 18 + se-003 8 + se-005 4
// ============================================================
const TABLES = ['table_1', 'table_2', 'table_3', 'table_4', 'table_5', 'table_6', 'table_7', 'table_8', 'table_9', 'table_10']
const PSTATUSES: PracticeTicket['status'][] = ['help_needed', 'assisting', 'solved', 'follow_up']
const PSEVERITIES: PracticeTicket['severity'][] = ['low', 'normal', 'high', 'blocker']

export const seedPractice: PracticeTicket[] = (() => {
  const rows: PracticeTicket[] = []
  const counts: Array<[string, number]> = [['se-001-DEMO', 18], ['se-003-DEMO', 8], ['se-005-DEMO', 4]]
  let i = 1
  for (const [sid, count] of counts) {
    for (let k = 0; k < count; k++) {
      rows.push({
        id: `pt-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        table_label: TABLES[k % TABLES.length],
        body: `실습 이슈 (DEMO #${k + 1})`,
        status: PSTATUSES[k % 4],
        severity: PSEVERITIES[k % 4],
        assigned_assistant_id: null,
        created_at: iso(k * 90_000),
        updated_at: iso(k * 90_000)
      })
    }
  }
  return rows
})()

// ============================================================
// resources (12) — se-001 6 + se-003 4 + se-005 2
// ============================================================
const RTYPES: Resource['type'][] = ['pdf', 'link', 'md', 'xlsx', 'image', 'html', 'prompt', 'code']
const RVIS: Resource['visibility'][] = ['session', 'public', 'session', 'admin_only']
export const seedResources: Resource[] = (() => {
  const rows: Resource[] = []
  const counts: Array<[string, number]> = [['se-001-DEMO', 6], ['se-003-DEMO', 4], ['se-005-DEMO', 2]]
  let i = 1
  for (const [sid, count] of counts) {
    for (let k = 0; k < count; k++) {
      const t = RTYPES[k % RTYPES.length]
      rows.push({
        id: `rs-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        type: t,
        title: `자료 (DEMO #${k + 1})`,
        url_or_storage_path: t === 'link' ? `https://example.com/demo-${i}` : `/demo/${sid}/${t}-${k + 1}`,
        visibility: RVIS[k % RVIS.length],
        stage_tags: ['live'],
        audience_tags: ['participant'],
        created_at: iso(k * 120_000)
      })
    }
  }
  return rows
})()

// ============================================================
// ops_logs (100) — se-001 60 + se-003 25 + se-005 15
// ============================================================
const OTYPES: OpsLog['type'][] = ['note', 'progress', 'mood', 'issue', 'signal', 'question', 'resource']
const OBODIES = [
  '강의 시작', '아이스브레이킹 완료', '참여도 양호', '챕터 진입', '음향 점검', '속도 조정', '심화 질문 발생',
  '실습 시작', '쉬는 시간', '오후 집중도 회복', '챕터 종료', '자료 추가 공유', '실습 막힘 발생', '실습 마무리',
  '에너지 회복', '운영 절차 질문', '네트워크 이슈', 'Q&A 정리', '세션 종료', '회고 시작'
]
export const seedOpsLogs: OpsLog[] = (() => {
  const rows: OpsLog[] = []
  const counts: Array<[string, number]> = [['se-001-DEMO', 60], ['se-003-DEMO', 25], ['se-005-DEMO', 15]]
  let i = 1
  for (const [sid, count] of counts) {
    for (let k = 0; k < count; k++) {
      rows.push({
        id: `op-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        type: OTYPES[k % OTYPES.length],
        body: `${OBODIES[k % OBODIES.length]} (DEMO)`,
        visibility: 'private',
        created_by_role: 'assistant',
        created_at: iso(k * 30_000)
      })
    }
  }
  return rows
})()

// ============================================================
// signals (15) — 7종 분산, se-001 9 + se-003 4 + se-005 2
// ============================================================
const STYPES: AssistantSignal['signal_type'][] = ['speed_down', 'break_needed', 'question_surge', 'practice_blocked', 'lunch_delay', 'network', 'mood_drop']
export const seedSignals: AssistantSignal[] = (() => {
  const rows: AssistantSignal[] = []
  const counts: Array<[string, number]> = [['se-001-DEMO', 9], ['se-003-DEMO', 4], ['se-005-DEMO', 2]]
  let i = 1
  for (const [sid, count] of counts) {
    for (let k = 0; k < count; k++) {
      rows.push({
        id: `sg-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        signal_type: STYPES[k % STYPES.length],
        table_label: k % 2 === 0 ? '' : TABLES[k % TABLES.length],
        note: `시그널 노트 (DEMO #${k + 1})`,
        acknowledged_at: k % 3 === 0 ? iso(k * 60_000) : null,
        created_at: iso(k * 60_000)
      })
    }
  }
  return rows
})()

// ============================================================
// table_statuses (30) — se-001 10 + se-003 5 + se-005 5 + 추가 분산 10
// ============================================================
const PROGRESSES: TableStatus['progress'][] = ['not_started', 'following', 'blocked', 'solved', 'waiting']
export const seedTableStatuses: TableStatus[] = (() => {
  const rows: TableStatus[] = []
  const counts: Array<[string, number]> = [['se-001-DEMO', 10], ['se-003-DEMO', 5], ['se-005-DEMO', 5], ['se-002-DEMO', 5], ['se-004-DEMO', 5]]
  let i = 1
  for (const [sid, count] of counts) {
    for (let k = 0; k < count; k++) {
      rows.push({
        id: `ts-${String(i++).padStart(3, '0')}-DEMO`,
        session_id: sid,
        table_label: TABLES[k % TABLES.length],
        progress: PROGRESSES[k % 5],
        blocker: k % 4 === 0 ? `이슈 (DEMO)` : '',
        assistant_id: null,
        updated_at: iso(k * 60_000)
      })
    }
  }
  return rows
})()

// ============================================================
// excel_templates (2) + cells (40)
// ============================================================
export const seedExcelTemplates: ExcelTemplate[] = [
  { id: 'ex-001-DEMO', session_id: 'se-001-DEMO', title: 'AI 활용 사례 정리-DEMO', version: 1, source_resource_id: null, schema_json: { columns: ['업무', '도구', '시간 절감', '비고'] }, created_at: NOW },
  { id: 'ex-002-DEMO', session_id: 'se-003-DEMO', title: '업무 자동화 체크리스트', version: 1, source_resource_id: null, schema_json: { columns: ['항목', '담당', '상태', '비고'] }, created_at: NOW }
]

export const seedExcelCells: ExcelCell[] = (() => {
  const cells: ExcelCell[] = []
  const fill = (tplId: string, headers: string[], rowsCount: number, startIdx: number) => {
    let idx = startIdx
    headers.forEach((h, i) => {
      cells.push({ id: `ec-${String(idx++).padStart(3, '0')}-DEMO`, template_id: tplId, sheet_name: 'Sheet1', cell_ref: String.fromCharCode(65 + i) + '1', value: h, formula: '', updated_by: 'seed', updated_at: NOW })
    })
    for (let r = 0; r < rowsCount; r++) {
      headers.forEach((_, i) => {
        cells.push({
          id: `ec-${String(idx++).padStart(3, '0')}-DEMO`,
          template_id: tplId,
          sheet_name: 'Sheet1',
          cell_ref: String.fromCharCode(65 + i) + (r + 2),
          value: `값 (DEMO ${r + 1}-${i + 1})`,
          formula: '',
          updated_by: 'seed',
          updated_at: NOW
        })
      })
    }
    return idx
  }
  let idx = 1
  idx = fill('ex-001-DEMO', ['업무', '도구', '시간 절감', '비고'], 4, idx) // 4*4+4 = 20 cells
  idx = fill('ex-002-DEMO', ['항목', '담당', '상태', '비고'], 4, idx) // 20
  return cells
})()

// ============================================================
// seat_layouts (1) + seat_marks (0) — Generic 8조 좌석 신호등 보드
// roster는 generic 참가자명만 사용 (실명 금지)
// ============================================================
const demoSeatRoster: Record<string, string[]> = Object.fromEntries(
  Array.from({ length: 8 }, (_, i) => {
    const n = i + 1
    const count = n <= 6 ? 5 : 4 // 1~6조 5석, 7~8조 4석 (38명)
    return [`${n}조`, Array.from({ length: count }, (_, k) => `${n}조 참가자${String.fromCharCode(65 + k)}`)]
  })
)

export const seedSeatLayouts: SeatLayout[] = [
  {
    id: 'sl-001-DEMO',
    session_id: 'se-001-DEMO',
    name: '8조 T자 좌석배치-DEMO',
    layout: buildEightTeamSeatLayout(demoSeatRoster),
    created_at: NOW,
    updated_at: NOW
  }
]

export const seedSeatMarks: SeatMark[] = []

export const seedSeatLayoutTemplates: SeatLayoutTemplate[] = [
  {
    id: 'slt-t8-332',
    slug: 'lecture-t8-332',
    name: 'T자 8팀 · 6석 (앞3 / 중간3 / 뒤2)',
    description: 'Lecture LiveOps 8팀 6석(총 48석)에 최적화된 Y축 보정형 T자 레이아웃',
    layout: buildLectureT8SeatLayout(),
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'slt-t5-6-32',
    slug: 't5-6-32',
    name: 'T자 5팀 · 6석 (앞3 / 뒤2)',
    description: 'T자 5팀 6석(총 30석) 기존 호환 배치도',
    layout: buildTshapeLayout({ teams: 5, seatsPerTeam: 6, perRow: 3 }),
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'slt-eight-team-8-6',
    slug: 'eight-team-8-6',
    name: 'Generic 8조 · 6석 (4/4 배치)',
    description: 'Generic AI교육 기본 8조 6석(총 48석) 배치도',
    layout: buildEightTeamSeatLayout(),
    created_at: NOW,
    updated_at: NOW
  }
]

