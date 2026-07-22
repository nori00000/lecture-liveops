/**
 * 의견 지형 접근 경계 회귀 테스트 (2026-07-22 이중 검증 C1 / H2).
 *
 * C1: votes.matrixForClustering 이 Neon 에서 admin 만 허용해 프로덕션 운영자(instructor/assistant)
 *     경로에서 지형이 조용히 죽었다. fixture 테스트만 초록이었으므로 **Neon 경로를 역할별로** 검증한다.
 * (H2 공개 payload 좌표 제거는 delib-landscape-privacy.test.ts 가 담당 — 이 파일은 Neon 모킹 때문에 분리)
 */

import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';

beforeAll(() => {
  process.env.AX_MODE = 'fixture';
});

// ------------------------------------------------------------
// C1 — Neon 경로 역할별 테스트 (query 를 모킹해 실제 DB 없이 SQL/역할 경계만 검증)
// ------------------------------------------------------------
const neonSpy = vi.hoisted(() => ({ calls: [] as Array<{ role: string; text: string; params: unknown[] }> }));

vi.mock('@/lib/db/neon', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/neon')>();
  return { ...actual, isNeonEnabled: () => true };
});

vi.mock('@/lib/db/neonHelpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/neonHelpers')>();
  return {
    ...actual,
    query: async (ctx: { role: string }, text: string, params: unknown[]) => {
      neonSpy.calls.push({ role: ctx.role, text, params });
      return [
        { id: 'sv-1', statement_id: 'st-1', participant_id: 'pa-1', vote: 'agree', created_at: '2026-07-22T00:00:00.000Z' }
      ];
    }
  };
});

import { votes } from '@/lib/db/repo';
import type { RlsRole } from '@/lib/db/neonHelpers';

describe('C1 — Neon 경로에서 운영자 역할이 투표행렬을 읽을 수 있다', () => {
  beforeEach(() => {
    neonSpy.calls.length = 0;
  });

  it.each<RlsRole>(['admin', 'instructor', 'assistant'])('%s 는 행렬을 받는다 (null 아님)', async (role) => {
    const rows = await votes.matrixForClustering({ role, sessionId: 'se-1' }, ['st-1']);
    expect(rows).not.toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0].participant_id).toBe('pa-1');
  });

  it('세션 경계는 SECURITY DEFINER RPC(delib_vote_matrix)가 강제한다 — raw select 를 쓰지 않는다', async () => {
    await votes.matrixForClustering({ role: 'instructor', sessionId: 'se-1' }, ['st-1']);
    expect(neonSpy.calls).toHaveLength(1);
    expect(neonSpy.calls[0].text).toContain('delib_vote_matrix($1)');
    expect(neonSpy.calls[0].text).not.toContain('from statement_votes');
    expect(neonSpy.calls[0].params).toEqual([['st-1']]);
  });

  it('participant 역할은 null 이고 쿼리 자체가 나가지 않는다', async () => {
    const rows = await votes.matrixForClustering({ role: 'participant', sessionId: 'se-1' }, ['st-1']);
    expect(rows).toBeNull();
    expect(neonSpy.calls).toHaveLength(0);
  });

  it('발언이 없으면 빈 배열 (null 과 구분 — "권한 없음"이 아니라 "표가 없음")', async () => {
    const rows = await votes.matrixForClustering({ role: 'instructor', sessionId: 'se-1' }, []);
    expect(rows).toEqual([]);
    expect(neonSpy.calls).toHaveLength(0);
  });
});
