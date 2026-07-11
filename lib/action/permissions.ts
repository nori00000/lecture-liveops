import type { Role } from '../db/schema'

// role × action allowlist
const MATRIX: Record<string, Role[]> = {
  'liveops.get_today_session': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.add_qna': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.answer_qna': ['admin', 'instructor'],
  'liveops.delete_qna': ['admin', 'instructor', 'assistant'],
  'liveops.update_qna_status': ['admin', 'instructor', 'assistant'],
  'liveops.create_practice_ticket': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.update_practice_ticket': ['admin', 'instructor', 'assistant'],
  'liveops.upload_resource': ['admin', 'instructor'],
  'liveops.attach_link': ['admin', 'instructor', 'assistant'],
  'liveops.append_ops_log': ['admin', 'instructor', 'assistant'],
  'liveops.delete_ops_log': ['admin', 'instructor', 'assistant'],
  'liveops.clear_seat_marks': ['admin', 'instructor', 'assistant'],
  'liveops.acknowledge_signal': ['admin', 'instructor', 'assistant'],
  'liveops.send_assistant_signal': ['admin', 'instructor', 'assistant'],
  'liveops.update_table_status': ['admin', 'instructor', 'assistant'],
  'liveops.update_seat_mark': ['admin', 'instructor', 'assistant'],
  'liveops.upsert_seat_layout': ['admin', 'instructor', 'assistant'],
  'liveops.list_seat_layout_templates': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.upsert_seat_layout_template': ['admin', 'instructor'],
  'liveops.apply_seat_layout_template': ['admin', 'instructor', 'assistant'],
  'liveops.open_collaborative_excel': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.update_excel_cell': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.export_session_archive': ['admin', 'instructor'],
  'liveops.preview_archive_target': ['admin', 'instructor'],
  'liveops.create_lecture_session': ['admin', 'instructor'],
  'liveops.ingest_raw_note': ['admin', 'instructor', 'assistant', 'participant'],
  'liveops.generate_situation_snapshot': ['admin', 'instructor', 'assistant'],
  'liveops.delete_observation': ['admin', 'instructor', 'assistant'],
  'liveops.resolve_observation': ['admin', 'instructor', 'assistant'],
  'liveops.update_observation': ['admin', 'instructor', 'assistant'],
  'liveops.update_session_phase': ['admin', 'instructor'],
  'liveops.end_session': ['admin', 'instructor'],
  'liveops.upsert_material_version': ['admin', 'instructor', 'assistant'],
  'liveops.list_session_dashboard': ['admin', 'instructor', 'assistant', 'participant']
}

export function isAllowed(action: string, role: Role): boolean {
  const allowed = MATRIX[action]
  if (!allowed) return false
  return allowed.includes(role)
}

export function allActions(): string[] {
  return Object.keys(MATRIX)
}
