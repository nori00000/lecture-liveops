/**
 * /api/p/enter route — 참가자 입장 시 서버가 participant row 를 1개 생성하고
 * 서명 쿠키에 participantId 를 심는지 검증 (C-B). 재입장 시 동일 participant 재사용(ballot stuffing 방지).
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import { POST } from '@/app/api/p/enter/route';
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession';
import { participants } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';

// 시드 참가자 access key (demo-hash-se-001-DEMO-part-1). fixture verify 는 demo-hash 규칙으로 매칭.
const PART_KEY = 'se-001-DEMO-part-1';
const SID = 'se-001-DEMO';

function enterReq(accessKey: string): Request {
  return new Request('http://localhost/api/p/enter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accessKey })
  });
}

function cookieToken(res: Response): string | undefined {
  // NextResponse.cookies 는 Set-Cookie 헤더로 직렬화된다.
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(new RegExp(`${PARTICIPANT_SESSION_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

describe('/api/p/enter — participant 신원 서버 배선', () => {
  beforeEach(() => resetStore());

  it('검증된 access key 입장 시 participant 를 생성하고 쿠키에 participantId 를 심는다', async () => {
    const res = await POST(enterReq(PART_KEY));
    const body = await res.clone().json();
    expect(body.ok).toBe(true);
    expect(body.sessionId).toBe(SID);

    const token = cookieToken(res);
    expect(token).toBeTruthy();
    const session = readParticipantSession(token);
    expect(session?.participantId).toMatch(/^pa-/);
    expect(session?.sessionId).toBe(SID);

    // DB 에도 access_key 바인딩된 participant 1개 생성.
    const all = await participants.list(adminContext(SID), SID);
    expect(all.length).toBe(1);
    expect(all[0].access_key_id).toBe('ak-004-DEMO'); // se-001 첫 participant key
  });

  it('재입장 시 동일 participant 재사용 — access_key 당 1인 (ballot stuffing 방지)', async () => {
    const first = await POST(enterReq(PART_KEY));
    const second = await POST(enterReq(PART_KEY));
    const p1 = readParticipantSession(cookieToken(first))?.participantId;
    const p2 = readParticipantSession(cookieToken(second))?.participantId;
    expect(p1).toBe(p2);
    const all = await participants.list(adminContext(SID), SID);
    expect(all.length).toBe(1); // 두 번 입장해도 participant 는 1개
  });

  it('잘못된 access key 는 403 + 쿠키 미발급', async () => {
    const res = await POST(enterReq('nope-invalid-key'));
    expect(res.status).toBe(403);
    expect(cookieToken(res)).toBeUndefined();
  });
});
