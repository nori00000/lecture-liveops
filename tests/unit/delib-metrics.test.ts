import { describe, it, expect } from 'vitest';
import { computeAppSubmissionDistributionByRound, computeSnapshotPayload, tallyVotes, type Tally } from '@/lib/delib/metrics';

describe('delib metrics — 스냅샷 지표', () => {
  it('tallyVotes — 찬반유보 집계', () => {
    expect(tallyVotes(['agree', 'agree', 'disagree', 'pass'])).toEqual({ agree: 2, disagree: 1, pass: 1 });
  });

  it('statement 별 찬성률·순찬성·leaning 계산', () => {
    const tallies: Record<string, Tally> = {
      s1: { agree: 8, disagree: 2, pass: 0 } // 10표, 찬성률 0.8
    };
    const p = computeSnapshotPayload([{ id: 's1', group_id: 'g1' }], tallies);
    const m = p.statements[0];
    expect(m.agreeRate).toBeCloseTo(0.8);
    expect(m.net).toBe(6);
    expect(m.leaning).toBe('agree');
  });

  it('consensus 랭킹은 합의 강도 높은 순, divisive 랭킹은 찬반 팽팽한 순', () => {
    const tallies: Record<string, Tally> = {
      consensusHigh: { agree: 10, disagree: 0, pass: 0 }, // 합의 1.0
      split: { agree: 5, disagree: 5, pass: 0 } // 찬반 팽팽 1.0
    };
    const p = computeSnapshotPayload(
      [{ id: 'consensusHigh', group_id: 'g1' }, { id: 'split', group_id: 'g1' }],
      tallies
    );
    expect(p.consensus[0].statementId).toBe('consensusHigh');
    expect(p.divisive[0].statementId).toBe('split');
  });

  it('소수의견 flag — 전체 다수 방향과 반대 방향인 발언', () => {
    // 전체 다수는 agree (s1,s2 강한 찬성). s3 는 반대 방향(disagree).
    const tallies: Record<string, Tally> = {
      s1: { agree: 9, disagree: 1, pass: 0 },
      s2: { agree: 8, disagree: 2, pass: 0 },
      s3: { agree: 1, disagree: 5, pass: 0 }
    };
    const p = computeSnapshotPayload(
      [{ id: 's1', group_id: 'g1' }, { id: 's2', group_id: 'g1' }, { id: 's3', group_id: 'g2' }],
      tallies
    );
    expect(p.overall.leaning).toBe('agree');
    expect(p.minority.map((m) => m.statementId)).toContain('s3');
    expect(p.minority.map((m) => m.statementId)).not.toContain('s1');
    expect(p.minority[0].margin).toBe(4); // |1-5|
  });

  it('소수의견 threshold — margin 미만은 flag 하지 않는다', () => {
    const tallies: Record<string, Tally> = {
      s1: { agree: 10, disagree: 0, pass: 0 },
      s2: { agree: 2, disagree: 3, pass: 0 } // margin 1
    };
    const noneAtThree = computeSnapshotPayload(
      [{ id: 's1', group_id: 'g1' }, { id: 's2', group_id: 'g1' }],
      tallies,
      { minorityMarginThreshold: 3 }
    );
    expect(noneAtThree.minority.length).toBe(0);
  });

  it('그룹 간 편차 — 그룹별 평균 찬성률 + spread', () => {
    const tallies: Record<string, Tally> = {
      a: { agree: 10, disagree: 0, pass: 0 }, // g1 찬성률 1.0
      b: { agree: 0, disagree: 10, pass: 0 } // g2 찬성률 0.0
    };
    const p = computeSnapshotPayload([{ id: 'a', group_id: 'g1' }, { id: 'b', group_id: 'g2' }], tallies);
    expect(p.groupDeviation.groups.length).toBe(2);
    expect(p.groupDeviation.agreeRateSpread).toBeCloseTo(1.0);
    expect(p.groupDeviation.agreeRateStdDev).toBeGreaterThan(0);
  });

  it('표 0건 발언은 안전하게 처리 (division by zero 없음)', () => {
    const p = computeSnapshotPayload([{ id: 'empty', group_id: null }], {});
    expect(p.statements[0].agreeRate).toBe(0);
    expect(p.statements[0].consensusScore).toBe(0);
    expect(p.consensus.length).toBe(0);
    expect(p.statements[0].suppressed).toBe(false); // 0건은 억제 아님 (역추론 정보 없음)
  });

  it('M-9 k-익명 — 총표수 < 3 발언은 억제(수치 마스킹 + 랭킹/집계 제외)', () => {
    const tallies: Record<string, Tally> = {
      tiny: { agree: 1, disagree: 1, pass: 0 }, // 2표 → 억제
      big: { agree: 5, disagree: 3, pass: 0 } // 8표 → 정상
    };
    const p = computeSnapshotPayload([{ id: 'tiny', group_id: 'g1' }, { id: 'big', group_id: 'g1' }], tallies);
    const tiny = p.statements.find((m) => m.statementId === 'tiny')!;
    expect(tiny.suppressed).toBe(true);
    expect(tiny.agree).toBe(0);
    expect(tiny.disagree).toBe(0);
    expect(tiny.total).toBe(0);
    // 억제 발언은 전체 집계에서 제외 (big 만 반영: 5/3)
    expect(p.overall.agree).toBe(5);
    expect(p.overall.disagree).toBe(3);
    // consensus/divisive 랭킹에도 미포함
    expect(p.consensus.map((m) => m.statementId)).not.toContain('tiny');
    expect(p.divisive.map((m) => m.statementId)).not.toContain('tiny');
  });

  it('M-9 k-익명 — N=1 단일 투표도 억제', () => {
    const p = computeSnapshotPayload([{ id: 's1', group_id: null }], { s1: { agree: 1, disagree: 0, pass: 0 } });
    expect(p.statements[0].suppressed).toBe(true);
    expect(p.overall.agree).toBe(0);
  });

  it('N-1 overall tie 시 소수의견 폭발 방지 — minority 비활성', () => {
    // 전체 찬반 동수(tie) — 다수 방향이 없으므로 모든 발언이 minority 로 폭발하면 안 됨.
    const tallies: Record<string, Tally> = {
      a: { agree: 5, disagree: 0, pass: 0 },
      b: { agree: 0, disagree: 5, pass: 0 }
    };
    const p = computeSnapshotPayload([{ id: 'a', group_id: 'g1' }, { id: 'b', group_id: 'g2' }], tallies);
    expect(p.overall.leaning).toBe('tie');
    expect(p.minority.length).toBe(0);
  });

  it('N-1 minority 기본 threshold 상향(2) — 표차 1 은 flag 하지 않음', () => {
    // 전체는 강한 agree. s3 는 반대 방향이지만 표차 1(2:3) → 기본 threshold 2 미만이라 제외.
    const tallies: Record<string, Tally> = {
      s1: { agree: 9, disagree: 0, pass: 0 },
      s2: { agree: 8, disagree: 0, pass: 0 },
      s3: { agree: 2, disagree: 3, pass: 0 } // margin 1
    };
    const p = computeSnapshotPayload([{ id: 's1', group_id: 'g1' }, { id: 's2', group_id: 'g1' }, { id: 's3', group_id: 'g2' }], tallies);
    expect(p.overall.leaning).toBe('agree');
    expect(p.minority.map((m) => m.statementId)).not.toContain('s3');
  });
});

describe('delib metrics — Q4 앱 제출 분포', () => {
  const groups = [
    { groupId: 'g1', memberCount: 4 },
    { groupId: 'g2', memberCount: 4 }
  ];

  it('라운드별 그룹 제출자 수와 제출 건수를 계산한다', () => {
    const out = computeAppSubmissionDistributionByRound([
      { statementId: 's1', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p1' },
      { statementId: 's2', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p2' },
      { statementId: 's3', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p3' },
      { statementId: 's4', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p1' },
      { statementId: 's5', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p5' },
      { statementId: 's6', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p6' },
      { statementId: 's7', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p7' }
    ], groups);
    const r1 = out[0];
    expect(r1.suppressed).toBe(false);
    const g1 = r1.groups.find((g) => g.groupId === 'g1')!;
    expect(g1.statementCount).toBe(4);
    expect(g1.submittedParticipants).toBe(3);
    expect(g1.submissionRatio).toBeCloseTo(0.75);
  });

  it('저자 미상 대리입력이 있는 라운드는 전체 분포를 억제한다', () => {
    const out = computeAppSubmissionDistributionByRound([
      { statementId: 's1', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p1' },
      { statementId: 's2', roundId: 'r1', groupId: 'g1', authorParticipantId: null }
    ], groups);
    expect(out[0].suppressed).toBe(true);
    expect(out[0].suppressionReason).toBe('proxy_entry');
    expect(out[0].groups.every((g) => g.suppressed && g.suppressionReason === 'proxy_entry')).toBe(true);
  });

  it('그룹 인원 또는 제출자 수가 k 미만이면 해당 그룹 수치를 억제한다', () => {
    const out = computeAppSubmissionDistributionByRound([
      { statementId: 's1', roundId: 'r1', groupId: 'tiny', authorParticipantId: 'p1' },
      { statementId: 's2', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p2' },
      { statementId: 's3', roundId: 'r1', groupId: 'g1', authorParticipantId: 'p3' },
      { statementId: 's4', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p5' },
      { statementId: 's5', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p6' },
      { statementId: 's6', roundId: 'r1', groupId: 'g2', authorParticipantId: 'p7' }
    ], [{ groupId: 'tiny', memberCount: 2 }, ...groups]);
    expect(out[0].groups.find((g) => g.groupId === 'tiny')?.suppressionReason).toBe('members');
    expect(out[0].groups.find((g) => g.groupId === 'g1')?.suppressionReason).toBe('submitters');
    expect(out[0].groups.find((g) => g.groupId === 'g2')?.suppressed).toBe(false);
  });
});

// ============================================================
// 결과판 랭킹 의미 회귀 (2026-08-04 데모 QA)
// 결함: consensusScore = |찬-반|/(찬+반) 이 방향맹이라 "찬 4 / 반 16" 이 합의강도 60% 로
//       합의점 섹션에 납품됐다. 또 컷오프가 없어 투표 있는 모든 발언이 consensus 와 divisive
//       양쪽에 전부 실렸다("합의점과 쟁점이 같은 목록").
// 기존 테스트는 극단값 2건만 써서 두 결함을 모두 통과시켰다.
// ============================================================
describe('delib metrics — 합의 방향 분리와 랭킹 컷오프', () => {
  it('반대 다수 발언은 합의점이 아니라 반대 합의로 간다', () => {
    const tallies: Record<string, Tally> = {
      agreed: { agree: 16, disagree: 4, pass: 0 },   // 쏠림 0.6 · 찬성 방향
      rejected: { agree: 4, disagree: 16, pass: 0 }  // 쏠림 0.6 · 반대 방향 (동일 강도)
    };
    const p = computeSnapshotPayload(
      [{ id: 'agreed', group_id: 'g1' }, { id: 'rejected', group_id: 'g1' }],
      tallies
    );
    // 강도는 같지만 방향이 다르다 — 같은 목록에 담기면 안 된다.
    expect(p.statements.find((m) => m.statementId === 'rejected')!.consensusScore).toBeCloseTo(0.6);
    expect(p.consensus.map((m) => m.statementId)).toEqual(['agreed']);
    expect(p.opposed.map((m) => m.statementId)).toEqual(['rejected']);
  });

  it('consensus 와 divisive 는 상호배타 — 같은 발언이 양쪽에 실리지 않는다', () => {
    const tallies: Record<string, Tally> = {
      strong: { agree: 18, disagree: 2, pass: 0 },  // 0.8 → 합의
      mild: { agree: 12, disagree: 8, pass: 0 },    // 0.2 → 쟁점
      split: { agree: 10, disagree: 10, pass: 0 },  // 0.0 → 쟁점
      no: { agree: 3, disagree: 17, pass: 0 }       // 0.7 → 반대 합의
    };
    const p = computeSnapshotPayload(
      Object.keys(tallies).map((id) => ({ id, group_id: 'g1' })),
      tallies
    );
    const ids = (ms: { statementId: string }[]) => ms.map((m) => m.statementId);
    const overlap = ids(p.consensus).concat(ids(p.opposed)).filter((id) => ids(p.divisive).includes(id));
    expect(overlap).toEqual([]);
    expect(ids(p.consensus)).toEqual(['strong']);
    expect(ids(p.opposed)).toEqual(['no']);
    expect(ids(p.divisive).sort()).toEqual(['mild', 'split']);
  });

  it('rankLimit 컷오프가 목록 길이를 자른다 (기본 5)', () => {
    const tallies: Record<string, Tally> = {};
    const metas = [];
    for (let i = 0; i < 9; i += 1) {
      tallies[`s${i}`] = { agree: 20 - i, disagree: i, pass: 0 }; // 전부 강한 찬성 합의
      metas.push({ id: `s${i}`, group_id: 'g1' });
    }
    const p = computeSnapshotPayload(metas, tallies);
    expect(p.consensus).toHaveLength(5);
    // 컷오프는 랭킹에만 적용된다 — 전량은 statements 에 남아 원자료 추적이 끊기지 않는다.
    expect(p.statements).toHaveLength(9);
    expect(computeSnapshotPayload(metas, tallies, { rankLimit: 2 }).consensus).toHaveLength(2);
  });

  it('소수의견은 컷오프를 받지 않는다 — 거버넌스 §7-3 소수의견 보존', () => {
    const tallies: Record<string, Tally> = {};
    const metas = [];
    for (let i = 0; i < 3; i += 1) {
      tallies[`maj${i}`] = { agree: 30, disagree: 1, pass: 0 };
      metas.push({ id: `maj${i}`, group_id: 'g1' });
    }
    for (let i = 0; i < 7; i += 1) {
      tallies[`min${i}`] = { agree: 1, disagree: 5 + i, pass: 0 }; // 전체 다수(agree)와 반대 방향
      metas.push({ id: `min${i}`, group_id: 'g1' });
    }
    const p = computeSnapshotPayload(metas, tallies);
    expect(p.minority.length).toBe(7); // 5 로 잘리면 소수 관점이 임의로 사라진다
  });

  it('레거시 스냅샷(opposed 없음)은 read 시점에 재분류된다 — 이미 발행된 세션 교정', async () => {
    const { normalizeSnapshotRankings } = await import('@/lib/delib/metrics');
    const tallies: Record<string, Tally> = {
      agreed: { agree: 16, disagree: 4, pass: 0 },
      rejected: { agree: 4, disagree: 16, pass: 0 }
    };
    const fresh = computeSnapshotPayload(
      [{ id: 'agreed', group_id: 'g1' }, { id: 'rejected', group_id: 'g1' }],
      tallies
    );
    // 옛 규칙으로 저장된 payload 를 흉내낸다: opposed 없음 + consensus 에 방향 무관 전량.
    const legacy = {
      statements: fresh.statements,
      overall: fresh.overall,
      consensus: fresh.statements.slice(),
      divisive: fresh.statements.slice(),
      minority: [],
      groupDeviation: fresh.groupDeviation
    };
    const fixed = normalizeSnapshotRankings(legacy);
    expect(fixed.consensus.map((m) => m.statementId)).toEqual(['agreed']);
    expect(fixed.opposed.map((m) => m.statementId)).toEqual(['rejected']);

    // 이미 신규 규칙으로 계산된 payload 는 건드리지 않는다(멱등).
    expect(normalizeSnapshotRankings(fresh).consensus.map((m) => m.statementId)).toEqual(['agreed']);
  });
});
