/**
 * 숙의 도메인 action handler 단위 테스트 (fixture mode).
 * happy path + 중복투표 방지 + moderation 상태 전이.
 * 보안 하드닝 후: participant 신원은 trusted(쿠키) 경로로만 주입, register 는 operator 전용.
 * AX_MODE 강제 fixture (DATABASE_URL 무시).
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import {
  updateWorkshopSettings,
  createWorkshop,
  registerParticipant,
  upsertGroup,
  assignParticipant,
  startRound,
  submitStatement,
  moderateStatement,
  voteStatement,
  computeSnapshot,
  publishSnapshot
} from '@/lib/action/handlers/delib';
import { votes, landscape } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';

const SID = 'se-001-DEMO';

function env(action: string, role: 'admin' | 'instructor' | 'assistant' | 'participant', input: unknown, sessionId = SID): AxActionEnvelope {
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

// M1: create_workshop/start_round 는 서버 사전합의 게이트를 통과해야 한다.
// 워크숍 시작 전 운영자가 프라이버시 설정 + 사전합의를 서버에 확정한다.
async function confirmConsent(sessionId = SID, minorSession = false, minorConsent = false): Promise<void> {
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', 'instructor', {
      sessionId,
      anonymousMode: false,
      disclosure: 'participants',
      retentionDays: 30,
      minorSession,
      consentConfirmed: true,
      minorConsent
    }, sessionId)
  });
}

// register 는 이제 operator 전용 — instructor 로 생성.
async function newParticipant(alias = 'p'): Promise<string> {
  const r = await registerParticipant({ envelope: env('delib.register_participant', 'instructor', { sessionId: SID, displayAlias: alias }) });
  return (r.data as { participantId: string }).participantId;
}

// operator 가 대리 제출한 발언 (author 없이도 가능).
async function newStatement(): Promise<string> {
  const r = await submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: '테스트 의견' }) });
  return (r.data as { statementId: string }).statementId;
}

describe('delib action handlers (fixture mode)', () => {
  beforeEach(async () => {
    resetStore();
    await confirmConsent(SID);
  });

  it('update_workshop_settings — privacy_settings 를 세션 metadata 에 영속', async () => {
    const r = await updateWorkshopSettings({
      envelope: env('delib.update_workshop_settings', 'instructor', {
        sessionId: SID,
        anonymousMode: true,
        disclosure: 'operators_only',
        retentionDays: 7,
        minorSession: false,
        consentConfirmed: true
      })
    });
    const ps = (r.data as { privacySettings: { anonymousMode: boolean; disclosure: string } }).privacySettings;
    expect(ps.anonymousMode).toBe(true);
    expect(ps.disclosure).toBe('operators_only');
  });

  it('createWorkshop — plenary round 0 생성', async () => {
    const r = await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: '기후 숙의' }) });
    expect((r.data as { roundId: string }).roundId).toMatch(/^wr-/);
  });

  it('registerParticipant — participant insert', async () => {
    const id = await newParticipant('가명A');
    expect(id).toMatch(/^pa-/);
  });

  it('upsertGroup 생성 후 groupId 로 update', async () => {
    const created = await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId: SID, label: '1조', topic: '찬성측' }) });
    const gid = (created.data as { groupId: string }).groupId;
    expect(gid).toMatch(/^wg-/);
    const updated = await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId: SID, groupId: gid, label: '1조-수정' }) });
    expect((updated.data as { groupId: string; label: string }).groupId).toBe(gid);
    expect((updated.data as { label: string }).label).toBe('1조-수정');
  });

  it('assignParticipant — 참가자를 그룹에 배정', async () => {
    const pid = await newParticipant();
    const g = await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId: SID, label: '2조' }) });
    const gid = (g.data as { groupId: string }).groupId;
    const r = await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: pid, groupId: gid }) });
    expect((r.data as { participantId: string; groupId: string })).toEqual({ participantId: pid, groupId: gid });
  });

  it('startRound — 라운드 시작 시 active, 이전 active 는 closed', async () => {
    await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: 'opening' }) });
    const r = await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: '1라운드', mode: 'breakout' }) });
    expect((r.data as { status: string }).status).toBe('active');
  });

  it('submitStatement — operator 대리 발언 제출', async () => {
    const sid = await newStatement();
    expect(sid).toMatch(/^st-/);
  });

  it('submitStatement — participant 는 trusted 쿠키 신원으로 저작', async () => {
    const pid = await newParticipant();
    const r = await submitStatement({ envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '참가자 의견' }), trusted: { participantId: pid } });
    expect((r.data as { statementId: string }).statementId).toMatch(/^st-/);
  });

  it('voteStatement — 중복투표 방지 (upsert 로 변경, row 1개 유지)', async () => {
    const stId = await newStatement();
    const pid = await newParticipant();
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'agree' }), trusted: { participantId: pid } });
    const second = await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'disagree' }), trusted: { participantId: pid } });
    expect((second.data as { vote: string }).vote).toBe('disagree');
    // unique(statement_id, participant_id): 같은 참가자 표는 1개만 존재, 최종값 disagree
    const rows = await votes.listByStatement(adminContext(SID), stId);
    expect(rows.length).toBe(1);
    expect(rows[0].vote).toBe('disagree');
  });

  it('moderateStatement — 상태 전이 visible→flagged→hidden→visible', async () => {
    const stId = await newStatement();
    const flagged = await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: stId, action: 'flag' }) });
    expect((flagged.data as { moderationState: string }).moderationState).toBe('flagged');
    const hidden = await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: stId, action: 'hide' }) });
    expect((hidden.data as { moderationState: string }).moderationState).toBe('hidden');
    const restored = await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: stId, action: 'restore', reason: '오탐' }) });
    expect((restored.data as { moderationState: string }).moderationState).toBe('visible');
  });

  it('moderateStatement — 없는 발언은 에러', async () => {
    await expect(
      moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: 'st-nope', action: 'flag' }) })
    ).rejects.toThrow();
  });

  it('compute_snapshot → publish_snapshot 흐름', async () => {
    const stId = await newStatement();
    const p1 = await newParticipant('p1');
    const p2 = await newParticipant('p2');
    const p3 = await newParticipant('p3');
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'agree' }), trusted: { participantId: p1 } });
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'disagree' }), trusted: { participantId: p2 } });
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'agree' }), trusted: { participantId: p3 } });
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID }) });
    const snapId = (snap.data as { snapshotId: string }).snapshotId;
    expect(snapId).toMatch(/^ls-/);
    expect((snap.data as { statementCount: number }).statementCount).toBe(1);
    const pub = await publishSnapshot({ envelope: env('delib.publish_snapshot', 'instructor', { snapshotId: snapId }) });
    expect((pub.data as { publishedAt: string | null }).publishedAt).toBeTruthy();
  });

  // Post-MVP B: 스냅샷 payload 에 의견 지형(landscape)이 함께 저장된다.
  // 소규모 세션(참가자 60명 미만)은 비활성 + 사유가 남아야 한다 — "왜 없는지"도 절차 증빙.
  it('computeSnapshot — 소규모 세션은 landscape 비활성 + 사유 기록', async () => {
    const stId = await newStatement();
    const p1 = await newParticipant('p1');
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, vote: 'agree' }), trusted: { participantId: p1 } });
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID }) });
    expect((snap.data as { landscapeEnabled: boolean }).landscapeEnabled).toBe(false);
    const stored = await landscape.findById(adminContext(SID), (snap.data as { snapshotId: string }).snapshotId);
    const payload = stored!.payload as { landscape?: { enabled: boolean; reason?: string }; consensus?: unknown[] };
    expect(payload.landscape?.enabled).toBe(false);
    expect(payload.landscape?.reason).toBe('participants_below_minimum');
    // 기존 랭킹은 그대로 유지 (클러스터링은 추가 레이어).
    expect(Array.isArray(payload.consensus)).toBe(true);
  });

  // 100명 규모 — 실제 액션 경로(개인 표 행렬 → 클러스터링)로 landscape 가 활성화된다.
  it('computeSnapshot — 100명 세션은 landscape 활성 + 개인 식별정보 미포함', async () => {
    const statementIds: string[] = [];
    for (let j = 0; j < 8; j += 1) statementIds.push(await newStatement());
    const participantIds: string[] = [];
    for (let i = 0; i < 100; i += 1) participantIds.push(await newParticipant(`p${i}`));
    for (let i = 0; i < participantIds.length; i += 1) {
      for (let j = 0; j < statementIds.length; j += 1) {
        const agree = j === 0 ? true : (i % 2 === 0) === (j % 2 === 0);
        await voteStatement({
          envelope: env('delib.vote_statement', 'participant', { statementId: statementIds[j], vote: agree ? 'agree' : 'disagree' }),
          trusted: { participantId: participantIds[i] }
        });
      }
    }
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID }) });
    expect((snap.data as { landscapeEnabled: boolean }).landscapeEnabled).toBe(true);
    const stored = await landscape.findById(adminContext(SID), (snap.data as { snapshotId: string }).snapshotId);
    const payload = stored!.payload as { landscape?: { enabled: boolean; k: number; projection: unknown[] } };
    expect(payload.landscape?.k).toBeGreaterThanOrEqual(2);
    expect(payload.landscape?.projection.length).toBe(100);
    // 스냅샷 payload 에 participantId 가 새어나가지 않아야 한다 (거버넌스 §7-2).
    const serialized = JSON.stringify(payload.landscape);
    for (const pid of participantIds) expect(serialized).not.toContain(pid);
  });

  it('computeSnapshot — hidden 발언은 집계에서 제외 (M-1)', async () => {
    const visible = await newStatement();
    const hidden = await newStatement();
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: hidden, action: 'hide' }) });
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID }) });
    // 발언 2건 중 hidden 1건 제외 → 집계 대상 1건.
    expect((snap.data as { statementCount: number }).statementCount).toBe(1);
    void visible;
  });
});
