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
  });
});
