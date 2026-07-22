/**
 * /api/export/delib route — 숙의 리포트 다운로드의 보안 경계 (F2).
 * 검증: (a) operator 게이트 2차 방어(미들웨어 누락 대비), (b) 다운로드 action_ledger 기록,
 *       (c) 존재하지 않는 세션은 404 (임의 sessionId 로 타 세션 리포트 생성 차단).
 * AX_MODE 강제 fixture (DATABASE_URL 무시).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

// operator 게이트 2차 방어 검증을 위해 쿠키를 항상 미보유 상태로 모킹.
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined })
}));

import { GET } from '@/app/api/export/delib/route';
import { ledger } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';

const SID = 'se-001-DEMO';

function exportReq(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/export/delib');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url.toString(), { method: 'GET' });
}

describe('/api/export/delib — 다운로드 보안 경계 (F2)', () => {
  beforeEach(() => resetStore());
  afterEach(() => { delete process.env.LIVEOPS_OPERATOR_KEY; });

  it('(c) 존재하지 않는 세션은 404 — 임의 sessionId 로 타 세션 리포트 생성 차단', async () => {
    const res = await GET(exportReq({ sessionId: 'se-does-not-exist', format: 'md' }));
    expect(res.status).toBe(404);
  });

  it('(b) 유효 세션 다운로드는 action_ledger 에 기록된다 (actor_role·sessionId·format·time)', async () => {
    const res = await GET(exportReq({ sessionId: SID, format: 'md' }));
    expect(res.status).toBe(200);

    const rows = await ledger.listBySession(adminContext(SID), SID);
    const exportRows = rows.filter((r) => r.action_name === 'delib.export_report');
    expect(exportRows.length).toBe(1);
    const row = exportRows[0];
    expect(row.session_id).toBe(SID);
    expect(row.actor_role).toBe('instructor');
    expect(row.status).toBe('ok');
    expect(row.input_redacted_summary).toContain('md');
    expect(row.created_at).toBeTruthy();
  });

  it('(b) 포맷별로 ledger 에 개별 기록된다', async () => {
    await GET(exportReq({ sessionId: SID, format: 'md' }));
    await GET(exportReq({ sessionId: SID, format: 'html' }));
    const rows = await ledger.listBySession(adminContext(SID), SID);
    const exportRows = rows.filter((r) => r.action_name === 'delib.export_report');
    expect(exportRows.length).toBe(2);
  });

  it('(a) operator 게이트 활성 + 쿠키 미보유면 401 (미들웨어 누락 대비 2차 방어)', async () => {
    process.env.LIVEOPS_OPERATOR_KEY = 'secret-operator-key';
    const res = await GET(exportReq({ sessionId: SID, format: 'md' }));
    expect(res.status).toBe(401);
    // 인증 실패 시 다운로드가 ledger 에 기록되지 않는다.
    const rows = await ledger.listBySession(adminContext(SID), SID);
    expect(rows.filter((r) => r.action_name === 'delib.export_report').length).toBe(0);
  });

  it('잘못된 format 은 400', async () => {
    const res = await GET(exportReq({ sessionId: SID, format: 'pdf' }));
    expect(res.status).toBe(400);
  });
});
