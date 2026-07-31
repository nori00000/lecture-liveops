/**
 * 숙의 도메인 보안 하드닝 회귀 테스트 (fixture mode).
 * 이중 적대 리뷰 CRITICAL/MAJOR 결함의 재발 방지 커버리지:
 *  - C-A 투표 위조 거부 (input.participantId 무시, trusted 만 사용)
 *  - C-B ballot stuffing (register participant 제거 + access_key 당 1인)
 *  - C-E 크로스세션 발언 / closed round 제출 거부
 *  - C-A/C-B 크로스세션 투표 거부
 *  - M-3 membership 1인1그룹 + 크로스세션 거부
 *  - M-4 startRound active 단일성
 *  - M-5 moderation 무의미 전이 거부
 *  - N-3 votes.listByStatement admin 가드
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
  voteStatement
} from '@/lib/action/handlers/delib';
import { isAllowed } from '@/lib/action/permissions';
import { votes, participants, delibGroups, delibRounds, statements } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';

const SID = 'se-001-DEMO';
const OTHER = 'se-003-DEMO';

function env(action: string, role: 'admin' | 'instructor' | 'assistant' | 'participant', input: unknown, sessionId = SID): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'sec-' + Math.random().toString(36).slice(2, 8),
    redactionPolicy: 'summary',
    dryRun: false,
    input
  };
}

async function mkParticipant(sessionId = SID, alias = 'p'): Promise<string> {
  const r = await registerParticipant({ envelope: env('delib.register_participant', 'instructor', { sessionId, displayAlias: alias }, sessionId) });
  return (r.data as { participantId: string }).participantId;
}
async function mkStatement(sessionId = SID): Promise<string> {
  const r = await submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId, body: '의견' }, sessionId) });
  return (r.data as { statementId: string }).statementId;
}
async function mkGroup(sessionId = SID, label = '조'): Promise<string> {
  const r = await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId, label }, sessionId) });
  return (r.data as { groupId: string }).groupId;
}
// M1: create_workshop/start_round 게이트 통과용 사전합의 확정.
async function confirmConsent(sessionId = SID, minorSession = false, minorConsent = false): Promise<void> {
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', 'instructor', {
      sessionId, anonymousMode: false, disclosure: 'participants', retentionDays: 30, minorSession, consentConfirmed: true, minorConsent
    }, sessionId)
  });
}

describe('delib 보안 — M1 프라이버시 사전합의 서버 게이트', () => {
  beforeEach(() => resetStore());

  it('사전합의 미확정이면 create_workshop 거부', async () => {
    await expect(
      createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: 'x' }) })
    ).rejects.toThrow(/consent not confirmed/);
  });

  it('사전합의 미확정이면 start_round 거부', async () => {
    await expect(
      startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: 'R1' }) })
    ).rejects.toThrow(/consent not confirmed/);
  });

  it('사전합의 확정 후 create_workshop 통과', async () => {
    await confirmConsent(SID);
    const r = await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: 'x' }) });
    expect((r.data as { roundId: string }).roundId).toMatch(/^wr-/);
  });

  it('미성년자 세션 — 법정대리인 동의 없으면 start_round 거부', async () => {
    // 사전합의는 했으나 minorSession=true 인데 minorConsent 미확보.
    await confirmConsent(SID, true, false);
    await expect(
      startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: 'R1' }) })
    ).rejects.toThrow(/minor guardian consent required/);
    // 법정대리인 동의 확보 후 통과.
    await confirmConsent(SID, true, true);
    const r = await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: 'R1' }) });
    expect((r.data as { status: string }).status).toBe('active');
  });

  it('update_workshop_settings 는 participant 권한 없음 (operator 전용)', () => {
    expect(isAllowed('delib.update_workshop_settings', 'participant')).toBe(false);
    expect(isAllowed('delib.update_workshop_settings', 'instructor')).toBe(true);
  });
});

describe('delib 보안 — 투표/발언 신원 위조 방어', () => {
  beforeEach(() => resetStore());

  it('C-A 투표 위조 거부 — input.participantId 를 무시하고 trusted 쿠키 신원으로만 기록', async () => {
    const victim = await mkParticipant(SID, 'victim');
    const attacker = await mkParticipant(SID, 'attacker');
    const st = await mkStatement();
    // attacker 가 victim 의 participantId 를 input 으로 위조 시도. 서버는 trusted=attacker 만 신뢰.
    await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: st, participantId: victim, vote: 'agree' }), trusted: { participantId: attacker } });
    const rows = await votes.listByStatement(adminContext(SID), st);
    expect(rows.length).toBe(1);
    expect(rows[0].participant_id).toBe(attacker); // victim 표로 위조되지 않음
    expect(rows.some((v) => v.participant_id === victim)).toBe(false);
  });

  it('C-A 투표 신원 부재 거부 — participant 인데 trusted 없으면 throw', async () => {
    const st = await mkStatement();
    const p = await mkParticipant();
    await expect(
      voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: st, participantId: p, vote: 'agree' }) })
    ).rejects.toThrow(/participant identity required/);
  });

  it('C-B ballot stuffing — participant 는 register_participant 권한 없음 (operator 전용)', () => {
    expect(isAllowed('delib.register_participant', 'participant')).toBe(false);
    expect(isAllowed('delib.register_participant', 'instructor')).toBe(true);
    expect(isAllowed('delib.register_participant', 'assistant')).toBe(true);
  });

  it('C-B access_key 당 participant 1개 — 같은 access_key_id 재사용 시 unique 위반', async () => {
    const ctx = adminContext(SID);
    await participants.register(ctx, { session_id: SID, display_alias: '', anon_handle: '', access_key_id: 'ak-001-DEMO' });
    await expect(
      participants.register(ctx, { session_id: SID, display_alias: '', anon_handle: '', access_key_id: 'ak-001-DEMO' })
    ).rejects.toThrow(/unique/);
  });

  it('C-A/C-B 크로스세션 투표 거부 — 타 세션 발언에 투표 불가', async () => {
    const stOther = await mkStatement(OTHER);
    const p = await mkParticipant(SID);
    // 참가자(SID)가 타 세션(OTHER) 발언에 투표 시도 → 세션 불일치.
    await expect(
      voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stOther, vote: 'agree' }, SID), trusted: { participantId: p } })
    ).rejects.toThrow(/session mismatch/);
  });
});

describe('delib 보안 — 발언 세션 경계 / closed round (C-E)', () => {
  beforeEach(async () => { resetStore(); await confirmConsent(SID); });

  it('크로스세션 group 발언 거부 — group 이 타 세션이면 throw', async () => {
    const otherGroup = await mkGroup(OTHER, '타세션조');
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, groupId: otherGroup, body: 'x' }) })
    ).rejects.toThrow(/session mismatch/);
  });

  it('크로스세션 author 발언 거부 — 저자 participant 가 타 세션이면 throw', async () => {
    const otherP = await mkParticipant(OTHER);
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: 'x' }, SID), trusted: { participantId: otherP } })
    ).rejects.toThrow(/session mismatch/);
  });

  it('closed round 제출 거부 — 닫힌 라운드에는 발언 불가', async () => {
    const r1 = await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: 'R1' }) });
    const round1 = (r1.data as { roundId: string }).roundId;
    // 라운드 2 시작 → 라운드 1 은 closed 로 전환.
    await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 2, title: 'R2' }) });
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, roundId: round1, body: '늦은 발언' }) })
    ).rejects.toThrow(/closed round/);
  });
});

// C1: 세션 경계(C-E)만으로는 막히지 않던 구멍 — **같은 세션 안의 남의 그룹**.
// assertStatementScope 는 group.session_id 만 봤기 때문에, 참가자가 /api/action 을 직접 호출해
// 자기 소속이 아닌 같은 세션 groupId 를 실으면 그 그룹 발언으로 저장됐다.
describe('delib 보안 — 참가자 그룹 위조 (C1)', () => {
  beforeEach(async () => { resetStore(); await confirmConsent(SID); });

  it('타 그룹 groupId 제출 거부 — 같은 세션이어도 소속이 아니면 throw', async () => {
    const gA = await mkGroup(SID, 'A조');
    const gB = await mkGroup(SID, 'B조');
    const attacker = await mkParticipant(SID, 'attacker');
    await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: attacker, groupId: gA }) });

    await expect(
      submitStatement({
        envelope: env('delib.submit_statement', 'participant', { sessionId: SID, groupId: gB, body: 'B조인 척' }, SID),
        trusted: { participantId: attacker }
      })
    ).rejects.toThrow(/membership mismatch/);

    // 거부는 조용한 무시가 아니어야 한다 — B조에 아무것도 남지 않는다.
    const all = await statements.list(adminContext(SID), SID);
    expect(all.filter((s) => s.group_id === gB)).toHaveLength(0);
  });

  it('참가자 groupId 는 서버 membership 으로 강제 — input 없이도 자기 그룹으로 귀속', async () => {
    const gA = await mkGroup(SID, 'A조');
    const p = await mkParticipant(SID, 'member');
    await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: p, groupId: gA }) });

    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '내 그룹 발언' }, SID),
      trusted: { participantId: p }
    });
    const st = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(st?.group_id).toBe(gA);
  });

  it('미배정 참가자는 group_id null — 임의 그룹 주장 불가', async () => {
    const gA = await mkGroup(SID, 'A조');
    const p = await mkParticipant(SID, 'ungrouped');

    await expect(
      submitStatement({
        envelope: env('delib.submit_statement', 'participant', { sessionId: SID, groupId: gA, body: '무단 소속' }, SID),
        trusted: { participantId: p }
      })
    ).rejects.toThrow(/membership mismatch/);

    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '전체 발언' }, SID),
      trusted: { participantId: p }
    });
    const st = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(st?.group_id).toBeNull();
  });

  it('operator 대리입력은 종전대로 groupId 지정 허용 — 퍼실 운영 경로 회귀 방지', async () => {
    const gA = await mkGroup(SID, 'A조');
    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, groupId: gA, body: '퍼실 기록' })
    });
    const st = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(st?.group_id).toBe(gA);
  });
});

describe('delib 보안 — 구조 무결성 (M-3/M-4/M-5)', () => {
  beforeEach(async () => { resetStore(); await confirmConsent(SID); });

  it('M-4 startRound active 단일성 — 여러 번 시작해도 세션당 active 1개', async () => {
    await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: 'R1' }) });
    await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 2, title: 'R2' }) });
    await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 3, title: 'R3' }) });
    const rounds = await delibRounds.list(adminContext(SID), SID);
    expect(rounds.filter((r) => r.status === 'active').length).toBe(1);
    expect(rounds.find((r) => r.status === 'active')?.round_index).toBe(3);
  });

  it('M-3 membership 1인1그룹 — 재배정 시 이전 그룹에서 제거', async () => {
    const p = await mkParticipant();
    const g1 = await mkGroup(SID, 'g1');
    const g2 = await mkGroup(SID, 'g2');
    await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: p, groupId: g1 }) });
    await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: p, groupId: g2 }) });
    const inG1 = await delibGroups.listMemberships(adminContext(SID), g1);
    const inG2 = await delibGroups.listMemberships(adminContext(SID), g2);
    expect(inG1.length).toBe(0);
    expect(inG2.map((m) => m.participant_id)).toEqual([p]);
  });

  it('M-3 membership 크로스세션 거부 — participant/group 세션 불일치 throw', async () => {
    const p = await mkParticipant(SID);
    const gOther = await mkGroup(OTHER, '타세션조');
    await expect(
      assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: p, groupId: gOther }) })
    ).rejects.toThrow(/session mismatch/);
  });

  it('M-5 moderation 무의미 전이 거부 — visible 에서 restore 는 불가', async () => {
    const st = await mkStatement();
    await expect(
      moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: st, action: 'restore' }) })
    ).rejects.toThrow(/invalid moderation transition/);
  });

  it('M-5 moderation 무의미 전이 거부 — hidden 에서 hide 는 불가', async () => {
    const st = await mkStatement();
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: st, action: 'hide' }) });
    await expect(
      moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: st, action: 'hide' }) })
    ).rejects.toThrow(/invalid moderation transition/);
  });

  it('N-3 votes.listByStatement 는 admin 전용 — 비-admin ctx 거부', async () => {
    const st = await mkStatement();
    await expect(votes.listByStatement({ role: 'instructor', sessionId: SID }, st)).rejects.toThrow(/admin-only/);
  });

  it('moderation 원자성 — 전이 시 감사 이벤트가 함께 기록된다', async () => {
    const st = await mkStatement();
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: st, action: 'flag', reason: '검토' }) });
    const events = await statements.listModerationEvents(adminContext(SID), st);
    expect(events.length).toBe(1);
    expect(events[0].action).toBe('flag');
    // operator gate 가 확인한 것은 세부 role 이 아니라 운영자 권한 집합이다.
    expect(events[0].actor_role).toBe('operator');
  });
});
