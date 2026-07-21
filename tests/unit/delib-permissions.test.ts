import { describe, it, expect } from 'vitest';
import { isAllowed } from '@/lib/action/permissions';
import { listCatalog } from '@/lib/action/catalog';

describe('delib permission matrix', () => {
  it('participant는 register/submit/vote 가능', () => {
    expect(isAllowed('delib.register_participant', 'participant')).toBe(true);
    expect(isAllowed('delib.submit_statement', 'participant')).toBe(true);
    expect(isAllowed('delib.vote_statement', 'participant')).toBe(true);
  });

  it('participant는 운영 액션 불가 (create/upsert_group/assign/start/moderate/compute/publish)', () => {
    for (const a of [
      'delib.create_workshop',
      'delib.upsert_group',
      'delib.assign_participant',
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
      expect(isAllowed('delib.moderate_statement', role)).toBe(true);
      expect(isAllowed('delib.compute_snapshot', role)).toBe(true);
    }
  });

  it('catalog 에 delib 액션 10종이 전부 등록되어 있다', () => {
    const delibActions = listCatalog().filter((a) => a.startsWith('delib.'));
    expect(delibActions.length).toBe(10);
  });
});
