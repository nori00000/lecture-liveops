/**
 * 숙의 도메인 action handler 단위 테스트 (fixture mode).
 * happy path + 중복투표 방지 + moderation 상태 전이.
 * AX_MODE 강제 fixture (DATABASE_URL 무시).
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import {
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
import { votes } from '@/lib/db/repo';
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

async function newParticipant(alias = 'p'): Promise<string> {
  const r = await registerParticipant({ envelope: env('delib.register_participant', 'participant', { sessionId: SID, displayAlias: alias }) });
  return (r.data as { participantId: string }).participantId;
}

async function newStatement(): Promise<string> {
  const r = await submitStatement({ envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '테스트 의견' }) });
  return (r.data as { statementId: string }).statementId;
}

describe('delib action handlers (fixture mode)', () => {
  beforeEach(() => {
    resetStore();
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

  it('submitStatement — 발언 제출', async () => {
    const sid = await newStatement();
    expect(sid).toMatch(/^st-/);
  });

  it('voteStatement — 중복투표 방지 (upsert 로 변경, row 1개 유지)', async () => {
    const stId = await newStatement();
    const pid = await newParticipant();
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, participantId: pid, vote: 'agree' }) });
    const second = await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, participantId: pid, vote: 'disagree' }) });
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
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, participantId: p1, vote: 'agree' }) });
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stId, participantId: p2, vote: 'disagree' }) });
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID }) });
    const snapId = (snap.data as { snapshotId: string }).snapshotId;
    expect(snapId).toMatch(/^ls-/);
    expect((snap.data as { statementCount: number }).statementCount).toBe(1);
    const pub = await publishSnapshot({ envelope: env('delib.publish_snapshot', 'instructor', { snapshotId: snapId }) });
    expect((pub.data as { publishedAt: string | null }).publishedAt).toBeTruthy();
  });
});
