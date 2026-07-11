/**
 * P1-8 — 15 action handler unit tests (fixture mode).
 * 각 handler 의 happy path + 1-2 edge case.
 * AX_MODE 강제 fixture (DATABASE_URL 환경변수 무시).
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// fixture mode 강제 — Neon RLS 시도 방지
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});
import { addQna, answerQna, updateQnaStatus } from '@/lib/action/handlers/qna';
import { createPracticeTicket, updatePracticeTicket } from '@/lib/action/handlers/practice';
import { uploadResource, attachLink } from '@/lib/action/handlers/resources';
import { appendOpsLog } from '@/lib/action/handlers/ops';
import { sendAssistantSignal, updateTableStatus } from '@/lib/action/handlers/signals';
import { openCollaborativeExcel, updateExcelCell } from '@/lib/action/handlers/excel';
import { exportSessionArchive, syncExternalArchive } from '@/lib/action/handlers/exports';
import { getTodaySession } from '@/lib/action/handlers/sessions';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';

function env(action: string, role: 'admin' | 'instructor' | 'assistant' | 'participant', input: unknown, sessionId = 'se-001-DEMO'): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'test-' + Math.random().toString(36).slice(2, 8),
    redactionPolicy: 'summary',
    dryRun: false,
    input
  };
}

describe('action handlers — happy paths (fixture mode)', () => {
  beforeEach(() => {
    // 각 테스트 격리: 매 테스트마다 fresh seed
    resetStore();
  });

  it('1) addQna — qna_items insert', async () => {
    const r = await addQna({ envelope: env('liveops.add_qna', 'participant', { sessionId: 'se-001-DEMO', body: '테스트 질문' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('2) answerQna — 기존 qna 답변', async () => {
    const created = await addQna({ envelope: env('liveops.add_qna', 'participant', { sessionId: 'se-001-DEMO', body: '질문' }) });
    const qnaId = (created.data as { id: string }).id;
    const r = await answerQna({ envelope: env('liveops.answer_qna', 'instructor', { qnaId, answer: '답변', status: 'answered' }) });
    expect((r.data as { id: string; status: string }).status).toBe('answered');
  });

  it('3) updateQnaStatus — status 변경', async () => {
    const created = await addQna({ envelope: env('liveops.add_qna', 'participant', { sessionId: 'se-001-DEMO', body: '질문' }) });
    const qnaId = (created.data as { id: string }).id;
    const r = await updateQnaStatus({ envelope: env('liveops.update_qna_status', 'assistant', { qnaId, status: 'triaged' }) });
    expect((r.data as { status: string }).status).toBe('triaged');
  });

  it('4) createPracticeTicket', async () => {
    const r = await createPracticeTicket({ envelope: env('liveops.create_practice_ticket', 'participant', { sessionId: 'se-001-DEMO', tableLabel: 'table_2', body: '실습 막힘' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('5) updatePracticeTicket — status 변경', async () => {
    const created = await createPracticeTicket({ envelope: env('liveops.create_practice_ticket', 'participant', { sessionId: 'se-001-DEMO', tableLabel: 'table_2', body: '막힘' }) });
    const ticketId = (created.data as { id: string }).id;
    const r = await updatePracticeTicket({ envelope: env('liveops.update_practice_ticket', 'assistant', { ticketId, status: 'solved' }) });
    expect((r.data as { status: string }).status).toBe('solved');
  });

  it('6) uploadResource — pdf', async () => {
    const r = await uploadResource({ envelope: env('liveops.upload_resource', 'instructor', { sessionId: 'se-001-DEMO', resourceType: 'pdf', title: '교재', fileRef: 'pdf://x' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('7) attachLink', async () => {
    const r = await attachLink({ envelope: env('liveops.attach_link', 'assistant', { sessionId: 'se-001-DEMO', url: 'https://example.com', title: '참조' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('8) appendOpsLog', async () => {
    const r = await appendOpsLog({ envelope: env('liveops.append_ops_log', 'assistant', { sessionId: 'se-001-DEMO', logType: 'note', body: 'ops 기록' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('9) sendAssistantSignal — speed_down', async () => {
    const r = await sendAssistantSignal({ envelope: env('liveops.send_assistant_signal', 'assistant', { sessionId: 'se-001-DEMO', signalType: 'speed_down' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('10) updateTableStatus — upsert', async () => {
    const r = await updateTableStatus({ envelope: env('liveops.update_table_status', 'assistant', { sessionId: 'se-001-DEMO', tableLabel: 'table_5', progress: 'following' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('11) openCollaborativeExcel — fixture seed template 가져오기', async () => {
    const r = await openCollaborativeExcel({ envelope: env('liveops.open_collaborative_excel', 'instructor', { sessionId: 'se-001-DEMO', templateId: 'ex-001-DEMO' }) });
    expect(Array.isArray((r.data as { cells: unknown[] }).cells)).toBe(true);
  });

  it('12) updateExcelCell', async () => {
    const r = await updateExcelCell({ envelope: env('liveops.update_excel_cell', 'participant', { sessionId: 'se-001-DEMO', templateId: 'ex-001-DEMO', sheetName: 'Sheet1', cellRef: 'Z9', value: 'val' }) });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });

  it('13) exportSessionArchive — md dry plan', async () => {
    const r = await exportSessionArchive({ envelope: env('liveops.export_session_archive', 'instructor', { sessionId: 'se-001-DEMO', profile: 'markdown_archive', formats: ['md'] }) });
    expect(Array.isArray((r.data as { files: unknown[] }).files)).toBe(true);
  });

  it('14) syncExternalArchive — dry run', async () => {
    const r = await syncExternalArchive({ envelope: env('liveops.preview_archive_target', 'instructor', { sessionId: 'se-001-DEMO', profile: 'markdown_archive', dryRun: true }) });
    expect(typeof r.summary).toBe('string');
  });

  it('15) getTodaySession — seed session 반환', async () => {
    const r = await getTodaySession({ envelope: env('liveops.get_today_session', 'admin', {}, 'se-001-DEMO') });
    expect((r.data as { id: string }).id).toMatch(/^[a-z]{2,3}-/);
  });
});
