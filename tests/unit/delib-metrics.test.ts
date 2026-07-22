import { describe, it, expect } from 'vitest';
import { computeSnapshotPayload, tallyVotes, type Tally } from '@/lib/delib/metrics';

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
