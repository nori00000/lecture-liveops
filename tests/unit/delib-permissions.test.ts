import { describe, it, expect } from 'vitest';
import { isAllowed } from '@/lib/action/permissions';
import { listCatalog } from '@/lib/action/catalog';

describe('delib permission matrix', () => {
  it('participant는 submit/vote 만 가능 (register 는 셀프서비스 제거, C-B)', () => {
    expect(isAllowed('delib.submit_statement', 'participant')).toBe(true);
    expect(isAllowed('delib.vote_statement', 'participant')).toBe(true);
  });

  it('participant는 register 불가 — 신원은 /p/enter 서버 경로에서만 생성 (C-B)', () => {
    expect(isAllowed('delib.register_participant', 'participant')).toBe(false);
  });

  it('participant는 운영 액션 불가 (create/register/upsert_group/assign/start/moderate/compute/publish)', () => {
    for (const a of [
      'delib.create_workshop',
      'delib.register_participant',
      'delib.upsert_group',
      'delib.assign_participant',
      'delib.issue_participant_access_key',
      'delib.start_round',
      'delib.moderate_statement',
      'delib.compute_snapshot',
      'delib.publish_snapshot'
    ]) {
      expect(isAllowed(a, 'participant')).toBe(false);
    }
  });

  it('operator(instructor/assistant/admin)는 운영 액션 가능', () => {
    for (const role of ['admin', 'instructor', 'assistant'] as const) {
      expect(isAllowed('delib.upsert_group', role)).toBe(true);
      expect(isAllowed('delib.issue_participant_access_key', role)).toBe(true);
      expect(isAllowed('delib.moderate_statement', role)).toBe(true);
      expect(isAllowed('delib.compute_snapshot', role)).toBe(true);
    }
  });

  it('update_workshop_settings 는 operator 전용 (participant 불가)', () => {
    expect(isAllowed('delib.update_workshop_settings', 'participant')).toBe(false);
    for (const role of ['admin', 'instructor', 'assistant'] as const) {
      expect(isAllowed('delib.update_workshop_settings', role)).toBe(true);
    }
  });

  it('catalog 에 delib 액션 14종이 전부 등록되어 있다 (Q2 검토 후보 2종 포함)', () => {
    const delibActions = listCatalog().filter((a) => a.startsWith('delib.'));
    expect(delibActions.length).toBe(14);
  });
});
