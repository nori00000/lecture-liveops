/**
 * 숙의 워크숍 end-to-end 흐름 (fixture mode).
 * 워크숍 생성 → 참가자 등록 → 그룹 배정 → 라운드 시작 → 의견 제출 → 투표 → 스냅샷 → 리포트 생성.
 * 실제 Neon 없이 fixture store 로 전 경로를 관통한다 (DATABASE_URL 무시).
 */

import { describe, it, expect, beforeAll } from 'vitest';

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
import { buildWorkshopReport } from '@/lib/delib/report';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';
import type { VoteValue } from '@/lib/db/schema';

const SID = 'se-002-DEMO';

function env(action: string, role: 'admin' | 'instructor' | 'assistant' | 'participant', input: unknown, sessionId = SID): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'itest-' + Math.random().toString(36).slice(2, 8),
    redactionPolicy: 'summary',
    dryRun: false,
    input
  };
}

describe('delib workshop end-to-end (fixture)', () => {
  it('생성→등록→배정→라운드→의견→투표→스냅샷→리포트 전 경로', async () => {
    resetStore();

    // 1. 프라이버시 사전 합의 + 워크숍 부트스트랩(오프닝 라운드 0)
    await updateWorkshopSettings({
      envelope: env('delib.update_workshop_settings', 'instructor', {
        sessionId: SID, anonymousMode: false, disclosure: 'operators_only', retentionDays: 14,
        minorSession: false, consentConfirmed: true
      })
    });
    await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: '오프닝' }) });

    // 2. 그룹 2개 + 라운드 1 시작
    const gA = (await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId: SID, label: 'A조', topic: '찬성측' }) })).data as { groupId: string };
    const gB = (await upsertGroup({ envelope: env('delib.upsert_group', 'instructor', { sessionId: SID, label: 'B조', topic: '반대측' }) })).data as { groupId: string };
    const round = (await startRound({ envelope: env('delib.start_round', 'instructor', { sessionId: SID, roundIndex: 1, title: '핵심 쟁점', mode: 'breakout' }) })).data as { roundId: string };

    // 3. 참가자 6명 등록 + 그룹 배정
    const pids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await registerParticipant({ envelope: env('delib.register_participant', 'instructor', { sessionId: SID, displayAlias: `참가자${i + 1}`, anonHandle: `anon-${i + 1}` }) });
      const pid = (r.data as { participantId: string }).participantId;
      pids.push(pid);
      await assignParticipant({ envelope: env('delib.assign_participant', 'instructor', { participantId: pid, groupId: i % 2 === 0 ? gA.groupId : gB.groupId }) });
    }

    // 4. 발언 3개 제출 (참가자 저작, 그룹 연결)
    const stIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await submitStatement({
        envelope: env('delib.submit_statement', 'participant', { sessionId: SID, roundId: round.roundId, groupId: i % 2 === 0 ? gA.groupId : gB.groupId, body: `쟁점 발언 ${i + 1}` }),
        trusted: { participantId: pids[i] }
      });
      stIds.push((r.data as { statementId: string }).statementId);
    }

    // 5. 투표 — 발언0 만장일치 찬성, 발언1 팽팽, 발언2 반대 우세
    const patterns: VoteValue[][] = [
      ['agree', 'agree', 'agree', 'agree', 'agree', 'agree'],
      ['agree', 'agree', 'agree', 'disagree', 'disagree', 'disagree'],
      ['disagree', 'disagree', 'disagree', 'disagree', 'agree', 'pass']
    ];
    for (let s = 0; s < stIds.length; s++) {
      for (let v = 0; v < pids.length; v++) {
        await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId: stIds[s], vote: patterns[s][v] }), trusted: { participantId: pids[v] } });
      }
    }

    // 6. 발언2 를 숨김 (moderation) → 리포트/집계에서 제외되어야 한다
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: stIds[2], action: 'hide', reason: '부적절' }) });

    // 7. 스냅샷 계산 + 발행
    const snap = await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID, roundId: round.roundId }) });
    const snapId = (snap.data as { snapshotId: string }).snapshotId;
    expect(snapId).toMatch(/^ls-/);
    const pub = await publishSnapshot({ envelope: env('delib.publish_snapshot', 'instructor', { snapshotId: snapId }) });
    expect((pub.data as { publishedAt: string | null }).publishedAt).toBeTruthy();

    // 8. 리포트 생성 검증
    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report).not.toBeNull();
    expect(report!.overview.participantCount).toBe(6);
    // 발언 3건 전부 원자료에 존재 (숨김 포함 — 절차 증빙).
    expect(report!.rawData.length).toBe(3);
    // 라운드 1 결과에 만장일치 발언0 이 합의점 최상위.
    const r1 = report!.rounds.find((r) => r.roundId === round.roundId)!;
    expect(r1.consensus.length).toBeGreaterThan(0);
    expect(r1.consensus[0].statementId).toBe(stIds[0]);
    // 숨김된 발언2 는 라운드 결과(consensus/divisive)에서 제외.
    expect(r1.consensus.map((c) => c.statementId)).not.toContain(stIds[2]);
    expect(r1.divisive.map((c) => c.statementId)).not.toContain(stIds[2]);
    // moderation 내역에 hide 1건 기록.
    expect(report!.moderation.byAction.hide).toBe(1);
    // 숨김 발언은 원자료에서 상태 라벨로 구분.
    expect(report!.rawData.find((r) => r.statementId === stIds[2])!.moderationState).toBe('hidden');
  });
});
