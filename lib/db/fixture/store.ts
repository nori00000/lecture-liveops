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
  ExportJob,
  ExternalArchive,
  LiveObservation,
  SituationSnapshotRow,
  MaterialVersionRow,
  ActionLedger,
  SeatLayout,
  SeatMark,
  SeatLayoutTemplate
} from '../schema'

import {
  seedCompanies,
  seedCourses,
  seedSessions,
  seedAccessKeys,
  seedQna,
  seedPractice,
  seedResources,
  seedOpsLogs,
  seedSignals,
  seedTableStatuses,
  seedExcelTemplates,
  seedExcelCells,
  seedSeatLayouts,
  seedSeatMarks,
  seedSeatLayoutTemplates
} from './seed'

type Store = {
  companies: Company[]
  courses: Course[]
  sessions: Session[]
  access_keys: AccessKey[]
  qna: Qna[]
  practice: PracticeTicket[]
  resources: Resource[]
  ops_logs: OpsLog[]
  signals: AssistantSignal[]
  table_statuses: TableStatus[]
  excel_templates: ExcelTemplate[]
  excel_cells: ExcelCell[]
  seat_layouts: SeatLayout[]
  seat_marks: SeatMark[]
  seat_layout_templates: SeatLayoutTemplate[]
  live_observations: LiveObservation[]

  situation_snapshots: SituationSnapshotRow[]
  material_versions: MaterialVersionRow[]
  export_jobs: ExportJob[]
  external_archives: ExternalArchive[]
  action_ledger: ActionLedger[]
  revision: number
}

declare global {
  var __AX_STORE__: Store | undefined
}

function initStore(): Store {
  return {
    companies: [...seedCompanies],
    courses: [...seedCourses],
    sessions: [...seedSessions],
    access_keys: [...seedAccessKeys],
    qna: [...seedQna],
    practice: [...seedPractice],
    resources: [...seedResources],
    ops_logs: [...seedOpsLogs],
    signals: [...seedSignals],
    table_statuses: [...seedTableStatuses],
    excel_templates: [...seedExcelTemplates],
    excel_cells: [...seedExcelCells],
    seat_layouts: [...seedSeatLayouts],
    seat_marks: [...seedSeatMarks],
    seat_layout_templates: [...seedSeatLayoutTemplates],
    live_observations: [],
    situation_snapshots: [],
    material_versions: [],
    export_jobs: [],
    external_archives: [],
    action_ledger: [],
    revision: 1
  }
}

export function getStore(): Store {
  if (!globalThis.__AX_STORE__) {
    globalThis.__AX_STORE__ = initStore()
  }
  return globalThis.__AX_STORE__!
}

export function bumpRevision(): number {
  const s = getStore()
  s.revision += 1
  return s.revision
}

// 테스트용: 매 테스트 격리 위해 fresh seed 로 reset.
export function resetStore(): void {
  globalThis.__AX_STORE__ = initStore()
}
