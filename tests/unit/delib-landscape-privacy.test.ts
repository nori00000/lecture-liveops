/**
 * 의견 지형 공개 payload 프라이버시 (2026-07-22 이중 검증 H2).
 *
 * 좌표(projection)는 익명화가 아니다 — 개인 투표 벡터의 저차원 서명이라
 * 공개 발언·현장 관찰과 결합하면 재식별이 가능하다.
 * 스냅샷 내부에는 남기되 공개 projector-view payload 에서는 제거되어야 한다.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import { GET } from '@/app/api/data/delib/projector-view/route';
import { landscape, sessions } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';

const SID = 'se-001-DEMO';

const FAKE_LANDSCAPE = {
  enabled: true,
  participantCount: 100,
  eligibleCount: 100,
  k: 2,
  silhouette: 0.7,
  explainedVarianceRatio: 0.62,
  lowExplainedVariance: false,
  suppressProjection: false,
  permutation: { iterations: 200, observed: 0.7, threshold95: 0.42, pValue: 0.005, passed: true },
  stability: { samples: 20, agreement: 1, unstable: false },
  missingness: [],
  analyzedStatementCount: 10,
  clusters: [
    { id: 0, size: 50, centroid: { x: -1, y: 0 } },
    { id: 1, size: 50, centroid: { x: 1, y: 0 } }
  ],
  projection: [
    { x: -1.2345678, y: 0.5, cluster: 0 },
    { x: 1.2345678, y: -0.5, cluster: 1 }
  ],
  gic: [],
  representatives: []
};

describe('H2 — projector-view 공개 payload 에 개별 좌표가 없다', () => {
  beforeEach(() => resetStore());

  it('projection 은 빈 배열이고 좌표 수치가 응답 본문 어디에도 없다', async () => {
    const ctx = adminContext(SID);
    expect(await sessions.findById(ctx, SID)).toBeTruthy();
    const snap = await landscape.compute(ctx, {
      session_id: SID,
      round_id: null,
      payload: { consensus: [], divisive: [], minority: [], landscape: FAKE_LANDSCAPE } as unknown as Record<string, unknown>
    });
    await landscape.publish(ctx, snap.id);

    const res = await GET(new Request(`http://localhost/api/data/delib/projector-view?sessionId=${SID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.published).toBe(true);
    expect(body.payload.landscape.projection).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('1.2345678');
    // 집계(클러스터 규모·설명분산·순열검정 근거)는 그대로 노출된다.
    expect(body.payload.landscape.clusters).toHaveLength(2);
    expect(body.payload.landscape.explainedVarianceRatio).toBeCloseTo(0.62, 10);
    expect(body.payload.landscape.permutation.passed).toBe(true);
  });

  it('스냅샷 원본에는 좌표가 그대로 남아있다 (제거는 공개 경로에서만)', async () => {
    const ctx = adminContext(SID);
    const snap = await landscape.compute(ctx, {
      session_id: SID,
      round_id: null,
      payload: { landscape: FAKE_LANDSCAPE } as unknown as Record<string, unknown>
    });
    await landscape.publish(ctx, snap.id);
    const stored = await landscape.findById(ctx, snap.id);
    const payload = stored!.payload as { landscape: { projection: unknown[] } };
    expect(payload.landscape.projection).toHaveLength(2);
  });
});
