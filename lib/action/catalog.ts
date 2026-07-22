import type { Handler } from './handlers/types'
import { getTodaySession } from './handlers/sessions'
import { addQna, answerQna, deleteQna, updateQnaStatus } from './handlers/qna'
import { createPracticeTicket, updatePracticeTicket } from './handlers/practice'
import { uploadResource, attachLink } from './handlers/resources'
import { appendOpsLog, deleteOpsLog } from './handlers/ops'
import { acknowledgeSignal, sendAssistantSignal, updateTableStatus } from './handlers/signals'
import { clearSeatMarks, updateSeatMark, upsertSeatLayout, listSeatLayoutTemplates, upsertSeatLayoutTemplate, applySeatLayoutTemplate } from './handlers/seatmap'
import { openCollaborativeExcel, updateExcelCell } from './handlers/excel'
import { exportSessionArchive, syncExternalArchive } from './handlers/exports'
import { createLectureSession, ingestRawNote, generateSituationSnapshot, deleteObservation, resolveObservation, updateObservation, updateSessionPhase, endSession, upsertMaterialVersion, listSessionDashboard } from './handlers/liveops'
import { updateWorkshopSettings, createWorkshop, registerParticipant, upsertGroup, assignParticipant, startRound, submitStatement, moderateStatement, voteStatement, computeSnapshot, publishSnapshot, computeAiObservations, reviewAiObservation } from './handlers/delib'

export const CATALOG: Record<string, Handler> = {
  'liveops.get_today_session': getTodaySession,
  'liveops.add_qna': addQna,
  'liveops.answer_qna': answerQna,
  'liveops.delete_qna': deleteQna,
  'liveops.update_qna_status': updateQnaStatus,
  'liveops.create_practice_ticket': createPracticeTicket,
  'liveops.update_practice_ticket': updatePracticeTicket,
  'liveops.upload_resource': uploadResource,
  'liveops.attach_link': attachLink,
  'liveops.append_ops_log': appendOpsLog,
  'liveops.delete_ops_log': deleteOpsLog,
  'liveops.send_assistant_signal': sendAssistantSignal,
  'liveops.acknowledge_signal': acknowledgeSignal,
  'liveops.update_table_status': updateTableStatus,
  'liveops.update_seat_mark': updateSeatMark,
  'liveops.upsert_seat_layout': upsertSeatLayout,
  'liveops.clear_seat_marks': clearSeatMarks,
  'liveops.list_seat_layout_templates': listSeatLayoutTemplates,
  'liveops.upsert_seat_layout_template': upsertSeatLayoutTemplate,
  'liveops.apply_seat_layout_template': applySeatLayoutTemplate,
  'liveops.open_collaborative_excel': openCollaborativeExcel,
  'liveops.update_excel_cell': updateExcelCell,
  'liveops.export_session_archive': exportSessionArchive,
  'liveops.preview_archive_target': syncExternalArchive,
  'liveops.create_lecture_session': createLectureSession,
  'liveops.ingest_raw_note': ingestRawNote,
  'liveops.generate_situation_snapshot': generateSituationSnapshot,
  'liveops.delete_observation': deleteObservation,
  'liveops.resolve_observation': resolveObservation,
  'liveops.update_observation': updateObservation,
  'liveops.update_session_phase': updateSessionPhase,
  'liveops.end_session': endSession,
  'liveops.upsert_material_version': upsertMaterialVersion,
  'liveops.list_session_dashboard': listSessionDashboard,
  'delib.update_workshop_settings': updateWorkshopSettings,
  'delib.create_workshop': createWorkshop,
  'delib.register_participant': registerParticipant,
  'delib.upsert_group': upsertGroup,
  'delib.assign_participant': assignParticipant,
  'delib.start_round': startRound,
  'delib.submit_statement': submitStatement,
  'delib.moderate_statement': moderateStatement,
  'delib.vote_statement': voteStatement,
  'delib.compute_snapshot': computeSnapshot,
  'delib.publish_snapshot': publishSnapshot,
  // Q2 — 사후 검토 후보 (compute_snapshot 과 분리된 비동기 경로, §3)
  'delib.compute_ai_observations': computeAiObservations,
  'delib.review_ai_observation': reviewAiObservation
}

export function listCatalog(): string[] {
  return Object.keys(CATALOG)
}
