import { describe, it, expect } from 'vitest';
import { createParticipantSession, readParticipantSession } from '@/lib/participantSession';
import type { AccessKey } from '@/lib/db/schema';

const key: AccessKey = {
  id: 'ak-test',
  session_id: 'se-001',
  role: 'participant',
  key_hash: 'demo-hash-test',
  expires_at: '2099-01-01T00:00:00.000Z',
  revoked_at: null,
  scope: {}
};

describe('participant identity — participantId/groupId 확장', () => {
  it('participantId/groupId 를 서명 세션에 round-trip 한다', () => {
    const now = Date.UTC(2026, 0, 1);
    const token = createParticipantSession(key, now, { participantId: 'pa-1', groupId: 'wg-1' });
    const parsed = readParticipantSession(token, now);
    expect(parsed).toMatchObject({ accessKeyId: 'ak-test', sessionId: 'se-001', role: 'participant', participantId: 'pa-1', groupId: 'wg-1' });
  });

  it('하위호환 — identity 없이 만든 기존 토큰도 파싱 성공 (필드 없음)', () => {
    const now = Date.UTC(2026, 0, 1);
    const token = createParticipantSession(key, now);
    const parsed = readParticipantSession(token, now);
    expect(parsed).toMatchObject({ accessKeyId: 'ak-test', sessionId: 'se-001', role: 'participant' });
    expect(parsed?.participantId).toBeUndefined();
    expect(parsed?.groupId).toBeUndefined();
  });

  it('participantId 만 있고 groupId 는 없을 수 있다 (부분 identity)', () => {
    const now = Date.UTC(2026, 0, 1);
    const token = createParticipantSession(key, now, { participantId: 'pa-2' });
    const parsed = readParticipantSession(token, now);
    expect(parsed?.participantId).toBe('pa-2');
    expect(parsed?.groupId).toBeUndefined();
  });

  it('identity 확장 후에도 서명 변조는 거부된다', () => {
    const token = createParticipantSession(key, Date.now(), { participantId: 'pa-3', groupId: 'wg-3' });
    expect(readParticipantSession(token.replace(/.$/, 'x'))).toBeNull();
  });
});
