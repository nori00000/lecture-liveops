import { describe, it, expect } from 'vitest';
import { isAllowed, allActions } from '@/lib/action/permissions';

describe('permission matrix', () => {
  it('participant는 add_qna 가능', () => {
    expect(isAllowed('liveops.add_qna', 'participant')).toBe(true);
  });

  it('participant는 answer_qna 불가', () => {
    expect(isAllowed('liveops.answer_qna', 'participant')).toBe(false);
  });

  it('instructor는 export 가능, assistant는 불가', () => {
    expect(isAllowed('liveops.export_session_archive', 'instructor')).toBe(true);
    expect(isAllowed('liveops.export_session_archive', 'assistant')).toBe(false);
  });

  it('admin은 모든 action 통과', () => {
    for (const a of allActions()) {
      expect(isAllowed(a, 'admin')).toBe(true);
    }
  });

  it('unknown action → false', () => {
    expect(isAllowed('liveops.nope', 'admin')).toBe(false);
  });

  it('allActions() 등록 액션 45개 (liveops 34종 + delib 11종)', () => {
    expect(allActions().length).toBe(45);
  });
});
