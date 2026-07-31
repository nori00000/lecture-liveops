/**
 * Dialogue(트랙 B) 노출 게이트 회귀 테스트 — 이중 적대 리뷰 CRITICAL 재발 방지.
 *
 *  - C2 전사 동의 우회: 동의 게이트가 ingest 만 막고 read 를 안 막아, recordingConsent=false 이거나
 *    source 의 consent_confirmed_at=null 인데도 전사 원문이 live/projector 화면에 그대로 떴다.
 *  - C3 projector 그룹 발언 노출: visibleOnly(moderation) 만 걸러 visibility='group' 발언이
 *    방 전체 스크린(Room Mirror)에 원문으로 올라갔다.
 *
 * 두 결함 모두 "빈 화면"이 정답인 fail-closed 케이스다 — 노출보다 미표시가 안전하다.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import { GET as liveGET } from '@/app/api/data/dialogue/live/route';
import { GET as projectorGET } from '@/app/api/data/dialogue/projector/route';
import { updateWorkshopSettings, upsertGroup, submitStatement } from '@/lib/action/handlers/delib';
import { getStore, resetStore, bumpRevision } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';

const SID = 'se-001-DEMO';
const SECRET = '전사원문기밀문장';
const GROUP_ONLY = '그룹안에서만하려던말';

function env(action: string, input: unknown): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role: 'instructor', tool: 'web-ui' },
    scope: { sessionId: SID },
    idempotencyKey: 'dlg-' + Math.random().toString(36).slice(2, 8),
    redactionPolicy: 'summary',
    dryRun: false,
    input
  };
}

async function saveSettings(recordingConsent: boolean): Promise<void> {
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', {
      sessionId: SID,
      anonymousMode: false,
      disclosure: 'participants',
      retentionDays: 30,
      minorSession: false,
      consentConfirmed: true,
      minorConsent: false,
      recordingConsent,
      offsiteProcessing: false
    })
  });
}

/** 전사 소스 1개 + 세그먼트 1개를 fixture 에 직접 심는다(전사 ingest 경로는 별도 테스트 대상). */
function seedTranscript(opts: { consentConfirmed: boolean }): void {
  const s = getStore();
  const now = new Date().toISOString();
  s.transcript_sources = [{
    id: 'ts-1',
    session_id: SID,
    group_id: null,
    device_label: '녹음기1',
    started_at: now,
    ended_at: null,
    consent_confirmed_at: opts.consentConfirmed ? now : null,
    created_at: now
  }];
  s.transcript_segments = [{
    id: 'tg-1',
    source_id: 'ts-1',
    round_id: null,
    speaker_tag: '화자1',
    started_ms: 0,
    ended_ms: 5000,
    text: SECRET,
    confidence: 0.9,
    created_at: now
  }];
  bumpRevision();
}

async function liveBody(): Promise<Record<string, unknown>> {
  const res = await liveGET(new Request(`http://localhost/api/data/dialogue/live?sessionId=${SID}`));
  expect(res.status).toBe(200);
  return res.json();
}
async function projectorBody(): Promise<Record<string, unknown>> {
  const res = await projectorGET(new Request(`http://localhost/api/data/dialogue/projector?sessionId=${SID}`));
  expect(res.status).toBe(200);
  return res.json();
}

describe('C2 — 전사 read 동의 게이트 (live / projector 공통)', () => {
  beforeEach(() => resetStore());

  it('recordingConsent=false 면 source 가 동의확정이어도 전사 원문이 나오지 않는다', async () => {
    await saveSettings(false);
    seedTranscript({ consentConfirmed: true });

    for (const body of [await liveBody(), await projectorBody()]) {
      expect(JSON.stringify(body)).not.toContain(SECRET);
      expect(body.mode).toBe('statement_preview');
    }
  });

  it('recordingConsent=true 여도 source 의 consent_confirmed_at 이 null 이면 전사 원문이 나오지 않는다', async () => {
    await saveSettings(true);
    seedTranscript({ consentConfirmed: false });

    for (const body of [await liveBody(), await projectorBody()]) {
      expect(JSON.stringify(body)).not.toContain(SECRET);
      expect(body.mode).toBe('statement_preview');
    }
  });

  it('두 층을 모두 통과하면 전사 모드로 정상 노출된다 — 게이트가 과차단하지 않는다', async () => {
    await saveSettings(true);
    seedTranscript({ consentConfirmed: true });

    const live = await liveBody();
    expect(live.mode).toBe('transcript');
    expect(JSON.stringify(live)).toContain(SECRET);
    expect((live.coverage as { sourceCount: number }).sourceCount).toBe(1);
  });

  it('동의 철회 시 coverage 도 0 으로 떨어진다 — 배지만 바뀌고 데이터가 남지 않는다', async () => {
    await saveSettings(false);
    seedTranscript({ consentConfirmed: true });

    const live = await liveBody();
    expect((live.coverage as { sourceCount: number }).sourceCount).toBe(0);
    expect((live.recording as { active: boolean }).active).toBe(false);
  });
});

describe('C3 — projector 는 public 발언만 방 전체에 노출한다', () => {
  beforeEach(() => resetStore());

  it("visibility='group' 발언은 projector payload 어디에도 원문이 없다", async () => {
    await saveSettings(false);
    const g = (await upsertGroup({ envelope: env('delib.upsert_group', { sessionId: SID, label: 'A조' }) })).data as { groupId: string };
    await submitStatement({
      envelope: env('delib.submit_statement', { sessionId: SID, groupId: g.groupId, body: GROUP_ONLY, visibility: 'group' })
    });

    const body = await projectorBody();
    expect(JSON.stringify(body)).not.toContain(GROUP_ONLY);
  });

  it("visibility='public' 발언은 projector 에 노출된다 — 게이트가 화면을 죽이지 않는다", async () => {
    await saveSettings(false);
    await submitStatement({
      envelope: env('delib.submit_statement', { sessionId: SID, body: '전체공개발언입니다', visibility: 'public' })
    });

    const body = await projectorBody();
    expect(JSON.stringify(body)).toContain('전체공개발언입니다');
  });

  it('live(퍼실 전용)는 group 발언을 계속 본다 — 운영 기능 회귀 방지', async () => {
    await saveSettings(false);
    const g = (await upsertGroup({ envelope: env('delib.upsert_group', { sessionId: SID, label: 'A조' }) })).data as { groupId: string };
    await submitStatement({
      envelope: env('delib.submit_statement', { sessionId: SID, groupId: g.groupId, body: GROUP_ONLY, visibility: 'group' })
    });

    const body = await liveBody();
    expect(JSON.stringify(body)).toContain(GROUP_ONLY);
  });
});
