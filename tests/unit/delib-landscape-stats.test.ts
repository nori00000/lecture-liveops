/**
 * 의견 지형 통계 하드닝 회귀 테스트 (2026-07-22 이중 검증 대응).
 *
 * 기존 delib-clustering.test.ts 는 "우리가 만든 규칙이 우리가 만든 픽스처에 적용되는가"를 확인하는
 * 자기참조 테스트였다(M1). 이 파일은 **반례** 를 던진다:
 *   - 구조가 없는 데이터에서 지형이 꺼지는가 (C2 — 가장 중요한 회귀 가드)
 *   - 진짜 3분할을 k=2 로 뭉개지 않는가 (C6)
 *   - 귀무가설 발언이 대표의견으로 뽑히지 않는가 (C4)
 *   - 참가자 1명을 빼면 결과가 뒤집히는지 알아채는가 (H5)
 *   - 결측률 높은 발언을 클러스터링에서 빼고 별도 표기하는가 (C5)
 *   - PCA 가 직교·비음수·수렴 보장을 지키는가 (H1)
 *   - 빈 클러스터가 생긴 k 를 배제하는가 (M2)
 */

import { describe, it, expect } from 'vitest';
import { createRng, kmeans, pca2d, type VoteRecord } from '@/lib/delib/clustering';
import { benjaminiHochberg, fisherExactTwoSided, proportionDiffTest, twoProportionZ, wilsonInterval } from '@/lib/delib/stats';
import { computeLandscape } from '@/lib/delib/landscapeMetrics';

type Dataset = { votes: VoteRecord[]; statementIds: string[]; participantIds: string[] };

function ids(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);
}

// 완전 무작위 투표 — 잠재 구조가 전혀 없다. 지형은 반드시 꺼져야 한다.
function randomVotes(n: number, d: number, seed: number): Dataset {
  const rng = createRng(seed);
  const statementIds = ids('s', d);
  const participantIds = ids('p', n);
  const votes: VoteRecord[] = [];
  for (const participantId of participantIds) {
    for (const statementId of statementIds) {
      const r = rng();
      votes.push({ participantId, statementId, vote: r < 0.45 ? 'agree' : r < 0.9 ? 'disagree' : 'pass' });
    }
  }
  return { votes, statementIds, participantIds };
}

// blocs 개 진영이 발언마다 서로 반대로 투표한다. flip 확률로 개별 이탈표를 섞는다.
function blocVotes(n: number, d: number, blocs: number, flip: number, seed: number): Dataset {
  const rng = createRng(seed);
  const statementIds = ids('s', d);
  const participantIds = ids('p', n);
  const votes: VoteRecord[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < d; j += 1) {
      let agree = j === 0 ? true : j % blocs === i % blocs;
      if (rng() < flip) agree = !agree;
      votes.push({ participantId: participantIds[i], statementId: statementIds[j], vote: agree ? 'agree' : 'disagree' });
    }
  }
  return { votes, statementIds, participantIds };
}

describe('C2 순열검정 — 구조 없는 데이터에서 지형이 꺼진다 (핵심 회귀 가드)', () => {
  it('완전 무작위 투표 30개 표본 중 활성되는 비율이 유의수준(5%) 수준으로 낮다', () => {
    let enabled = 0;
    const reasons = new Set<string>();
    for (let seed = 1; seed <= 30; seed += 1) {
      const r = computeLandscape(randomVotes(80, 15, seed * 7919));
      if (r.enabled) enabled += 1;
      else reasons.add(String(r.reason));
    }
    // 절대 실루엣 임계(0.3) 시절에는 89.7% 가 통과했다. 순열검정은 유의수준 근처로 눌러야 한다.
    expect(enabled).toBeLessThanOrEqual(4);
    expect(reasons.has('low_separation')).toBe(true);
  }, 60_000);

  it('비활성 사유는 low_separation 이고 순열검정 근거가 함께 기록된다', () => {
    const r = computeLandscape(randomVotes(80, 15, 7919));
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('low_separation');
    expect(r.permutation).not.toBeNull();
    expect(r.permutation!.passed).toBe(false);
    // 관측 실루엣은 0.3 을 넘지만(과거 임계는 통과) null 분포 95th 백분위는 못 넘는다.
    expect(r.permutation!.observed).toBeGreaterThan(0.3);
    expect(r.permutation!.observed).toBeLessThanOrEqual(r.permutation!.threshold95);
    expect(r.permutation!.iterations).toBeGreaterThanOrEqual(40);
  });

  it('진짜 구조가 있으면 통과한다 (게이트가 무조건 막는 것이 아님)', () => {
    const r = computeLandscape(blocVotes(120, 15, 3, 0.05, 9));
    expect(r.enabled).toBe(true);
    expect(r.permutation!.passed).toBe(true);
    expect(r.permutation!.observed).toBeGreaterThan(r.permutation!.threshold95);
    expect(r.permutation!.pValue).toBeLessThan(0.05);
  });

  it('순열검정은 결정론적이다 (셔플도 고정 시드)', () => {
    const data = randomVotes(80, 15, 4242);
    const first = JSON.stringify(computeLandscape(data));
    for (let i = 0; i < 5; i += 1) expect(JSON.stringify(computeLandscape(data))).toBe(first);
  });
});

describe('C6 k 범위 — 진짜 3분할을 k=2 로 뭉개지 않는다', () => {
  it('60명 3진영 → k=3 으로 잡힌다 (구 정책은 k=2 고정이었다)', () => {
    const r = computeLandscape(blocVotes(60, 12, 3, 0.02, 31));
    expect(r.enabled).toBe(true);
    expect(r.k).toBe(3);
    for (const c of r.clusters) expect(c.size).toBeGreaterThanOrEqual(20);
  });

  it('60~99명은 k∈{2,3} 로 제한된다 (클러스터당 20명 규칙 유지)', () => {
    const r = computeLandscape(blocVotes(80, 16, 4, 0.02, 33));
    expect(r.enabled).toBe(true);
    expect(r.k).toBeLessThanOrEqual(3);
    for (const c of r.clusters) expect(c.size).toBeGreaterThanOrEqual(20);
  });

  it('100명+ 는 k∈{2..5} 후보를 모두 검토한다', () => {
    const r = computeLandscape(blocVotes(120, 16, 4, 0.02, 35));
    expect(r.enabled).toBe(true);
    expect(r.k).toBe(4);
  });
});

describe('C3 설명분산 — 2D 좌표가 얼마나 설명하는지 노출한다', () => {
  it('강한 2진영 데이터는 설명분산이 높고 경고/차단 플래그가 꺼진다', () => {
    const r = computeLandscape(blocVotes(120, 14, 2, 0.02, 41));
    expect(r.enabled).toBe(true);
    expect(r.explainedVarianceRatio).toBeGreaterThan(0.5);
    expect(r.lowExplainedVariance).toBe(false);
    expect(r.suppressProjection).toBe(false);
  });

  it('임계는 설정 가능하고, 낮추면 경고·산점도 차단 플래그가 켜진다', () => {
    const r = computeLandscape(blocVotes(120, 14, 2, 0.02, 41), {
      lowVarianceWarnThreshold: 0.99,
      varianceSuppressThreshold: 0.98
    });
    expect(r.enabled).toBe(true);
    expect(r.lowExplainedVariance).toBe(true);
    expect(r.suppressProjection).toBe(true);
  });
});

describe('C4 대표의견 — 귀무가설 발언은 뽑히지 않는다', () => {
  // 구조(진영)를 만드는 signal 발언 + 진영과 무관하게 무작위인 null 발언을 섞는다.
  // 대표의견은 signal 발언에서만 나와야 한다.
  function mixed(seed: number, signals: number, nulls: number, n = 120): Dataset {
    const rng = createRng(seed);
    const statementIds = [...ids('sig', signals), ...ids('nul', nulls)];
    const participantIds = ids('p', n);
    const votes: VoteRecord[] = [];
    for (let i = 0; i < n; i += 1) {
      const bloc = i % 2;
      for (let j = 0; j < signals; j += 1) {
        let agree = j % 2 === bloc;
        if (rng() < 0.03) agree = !agree;
        votes.push({ participantId: participantIds[i], statementId: `sig${String(j).padStart(3, '0')}`, vote: agree ? 'agree' : 'disagree' });
      }
      for (let j = 0; j < nulls; j += 1) {
        // 진영과 완전히 독립인 투표 — 그룹 간 차이가 없다.
        votes.push({ participantId: participantIds[i], statementId: `nul${String(j).padStart(3, '0')}`, vote: rng() < 0.5 ? 'agree' : 'disagree' });
      }
    }
    return { votes, statementIds, participantIds };
  }

  it('귀무가설 발언이 대표의견에 오르는 비율이 낮다 (구 규칙은 100% 였다)', () => {
    let nullPicks = 0;
    let totalPicks = 0;
    let enabledRuns = 0;
    for (let seed = 1; seed <= 10; seed += 1) {
      const r = computeLandscape(mixed(seed * 104729, 8, 12));
      if (!r.enabled) continue;
      enabledRuns += 1;
      for (const rep of r.representatives) {
        totalPicks += 1;
        if (rep.statementId.startsWith('nul')) nullPicks += 1;
      }
    }
    expect(enabledRuns).toBeGreaterThan(0);
    expect(totalPicks).toBeGreaterThan(0);
    expect(nullPicks / totalPicks).toBeLessThan(0.1);
  }, 60_000);

  it('채택된 대표의견은 보정 p<0.05 그리고 lift≥0.2 를 모두 만족한다', () => {
    const r = computeLandscape(mixed(104729, 8, 12));
    expect(r.enabled).toBe(true);
    expect(r.representatives.length).toBeGreaterThan(0);
    for (const rep of r.representatives) {
      expect(rep.pAdjusted).toBeLessThan(0.05);
      expect(rep.lift).toBeGreaterThanOrEqual(0.2);
      expect(rep.pAdjusted).toBeGreaterThanOrEqual(rep.pValue); // BH 는 항상 p 를 키운다
      expect(['z', 'fisher']).toContain(rep.test);
      expect(rep.rank).toBeGreaterThanOrEqual(1);
      expect(['strong', 'moderate', 'slight']).toContain(rep.bucket);
    }
  });

  it('H3 노출 임계 — 그룹 내 유효표가 max(10, 30%) 미만인 발언은 대표의견이 될 수 없다', () => {
    const r = computeLandscape(mixed(104729, 8, 12));
    expect(r.enabled).toBe(true);
    for (const rep of r.representatives) {
      const size = r.clusters.find((c) => c.id === rep.clusterId)!.size;
      expect(rep.insideVotes).toBeGreaterThanOrEqual(Math.max(10, Math.ceil(size * 0.3)));
    }
  });
});

describe('C5 MNAR — 결측률 높은 발언은 클러스터링에서 빼되 삭제하지 않는다', () => {
  function withAvoidance(seed: number): Dataset {
    const base = blocVotes(120, 12, 2, 0.02, seed);
    // s001 은 참가자의 70% 가 응답하지 않는다 (회피).
    const votes = base.votes.filter((v) => {
      if (v.statementId !== 's001') return true;
      return Number(v.participantId.slice(1)) % 10 < 3;
    });
    return { ...base, votes };
  }

  it('결측률 40% 초과 발언은 excluded 로 표기되고 분석 발언 수에서 빠진다', () => {
    const r = computeLandscape(withAvoidance(51));
    const avoided = r.missingness.filter((m) => m.excluded);
    expect(avoided.map((m) => m.statementId)).toEqual(['s001']);
    expect(avoided[0].missingRate).toBeGreaterThan(0.4);
    expect(r.analyzedStatementCount).toBe(11);
    // 삭제가 아니라 별도 표기 — missingness 에는 전체 발언이 남는다.
    expect(r.missingness).toHaveLength(12);
  });

  it('제외된 발언은 GIC/대표의견에도 등장하지 않는다', () => {
    const r = computeLandscape(withAvoidance(51));
    expect(r.enabled).toBe(true);
    expect(r.gic.some((g) => g.statementId === 's001')).toBe(false);
    expect(r.representatives.some((x) => x.statementId === 's001')).toBe(false);
  });

  it('임계를 넘지 않는 결측은 그대로 분석에 포함된다', () => {
    const r = computeLandscape(withAvoidance(51), { maxMissingRate: 0.95 });
    expect(r.analyzedStatementCount).toBe(12);
    expect(r.missingness.every((m) => !m.excluded)).toBe(true);
  });
});

describe('H5 안정성 — leave-one-out 라벨 일치율', () => {
  it('명확히 분리된 데이터는 일치율 100% 이고 unstable 이 아니다', () => {
    const r = computeLandscape(blocVotes(120, 14, 2, 0.01, 61));
    expect(r.enabled).toBe(true);
    expect(r.stability).not.toBeNull();
    expect(r.stability!.agreement).toBeGreaterThan(0.99);
    expect(r.stability!.unstable).toBe(false);
  });

  it('임계를 100% 로 올리면 경고가 켜진다 (판정 로직 자체 검증)', () => {
    const r = computeLandscape(blocVotes(120, 14, 2, 0.05, 63), { stabilityThreshold: 1.01 });
    expect(r.enabled).toBe(true);
    expect(r.stability!.unstable).toBe(true);
  });

  it('표본 수는 결정론적으로 선택된다 (같은 입력 → 같은 안정성 수치)', () => {
    const data = blocVotes(120, 14, 2, 0.05, 65);
    const a = computeLandscape(data);
    const b = computeLandscape(data);
    expect(a.stability).toEqual(b.stability);
  });
});

describe('H1 PCA — 직교성 / 비음수 고유값 / 준퇴화', () => {
  it('두 주성분은 직교하고 고유값은 음수가 아니다', () => {
    const rng = createRng(77);
    const rows = Array.from({ length: 60 }, () => Array.from({ length: 12 }, () => rng() * 2 - 1));
    const r = pca2d(rows);
    let dot = 0;
    for (let i = 0; i < r.components[0].length; i += 1) dot += r.components[0][i] * r.components[1][i];
    expect(Math.abs(dot)).toBeLessThan(1e-8);
    expect(r.eigenvalues[0]).toBeGreaterThanOrEqual(0);
    expect(r.eigenvalues[1]).toBeGreaterThanOrEqual(0);
    expect(r.converged).toBe(true);
  });

  it('near-rank-1 데이터 — 제2고유값은 0 으로 clamp 되고 y 좌표가 전부 0', () => {
    // 두 열이 완전 상관 + 미세 수치잡음 → 실질 랭크 1.
    const rows = Array.from({ length: 40 }, (_, i) => {
      const t = i - 20;
      return [t, t * 2, t * 3];
    });
    const r = pca2d(rows);
    expect(r.eigenvalues[1]).toBe(0);
    for (const p of r.points) expect(Math.abs(p.y)).toBeLessThan(1e-9);
    // 설명분산은 1에 가깝다 (전부 첫 축이 설명).
    expect(r.explainedVarianceRatio).toBeGreaterThan(0.999);
  });

  it('explainedVarianceRatio = (λ1+λ2)/trace 이고 0~1 범위', () => {
    const rng = createRng(79);
    const rows = Array.from({ length: 50 }, () => Array.from({ length: 8 }, () => rng() * 2 - 1));
    const r = pca2d(rows);
    expect(r.explainedVarianceRatio).toBeCloseTo((r.eigenvalues[0] + r.eigenvalues[1]) / r.totalVariance, 12);
    expect(r.explainedVarianceRatio).toBeGreaterThan(0);
    expect(r.explainedVarianceRatio).toBeLessThanOrEqual(1);
  });
});

describe('M2 빈 클러스터', () => {
  it('점보다 큰 k 를 요청하면 emptyClusterCount 로 드러난다', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 10, y: 0 }
    ];
    const km = kmeans(points, 5);
    expect(km.emptyClusterCount).toBeGreaterThan(0);
  });

  it('완전히 겹친 점들에 k=3 을 요청하면 빈 클러스터가 생기고 카운트된다', () => {
    const points = Array.from({ length: 10 }, () => ({ x: 1, y: 1 }));
    const km = kmeans(points, 3);
    expect(km.emptyClusterCount).toBeGreaterThan(0);
  });
});

describe('통계 유틸 (stats.ts)', () => {
  it('two-proportion z — 큰 차이는 유의, 차이 없으면 p≈1', () => {
    expect(twoProportionZ(90, 100, 10, 100)).toBeLessThan(1e-10);
    expect(twoProportionZ(50, 100, 50, 100)).toBeCloseTo(1, 6);
  });

  it('Fisher 정확검정 — 교과서 2×2 값과 일치 (Tea tasting 3/4)', () => {
    // [[3,1],[1,3]] 의 양측 p = 0.4857142857...
    expect(fisherExactTwoSided(3, 1, 1, 3)).toBeCloseTo(17 / 35, 10);
    // [[4,0],[0,4]] 의 양측 p = 2/70
    expect(fisherExactTwoSided(4, 0, 0, 4)).toBeCloseTo(2 / 70, 10);
  });

  it('소표본은 자동으로 Fisher 로 전환된다', () => {
    expect(proportionDiffTest(4, 4, 0, 4).method).toBe('fisher');
    expect(proportionDiffTest(90, 100, 10, 100).method).toBe('z');
  });

  it('Benjamini-Hochberg — 단조 증가 + p 보다 크거나 같다', () => {
    const p = [0.001, 0.008, 0.039, 0.041, 0.042, 0.06, 0.074, 0.205, 0.212, 0.216];
    const adj = benjaminiHochberg(p);
    expect(adj).toHaveLength(p.length);
    for (let i = 0; i < p.length; i += 1) expect(adj[i]).toBeGreaterThanOrEqual(p[i]);
    for (let i = 1; i < p.length; i += 1) expect(adj[i]).toBeGreaterThanOrEqual(adj[i - 1] - 1e-15);
    // 표준 예제 (Benjamini-Hochberg 1995 Table): 첫 값의 보정치는 0.01.
    expect(adj[0]).toBeCloseTo(0.01, 10);
  });

  it('Wilson 구간 — 관측 비율을 포함하고 0~1 안에 있다', () => {
    const ci = wilsonInterval(8, 10);
    expect(ci.low).toBeGreaterThan(0);
    expect(ci.high).toBeLessThanOrEqual(1);
    expect(ci.low).toBeLessThan(0.8);
    expect(ci.high).toBeGreaterThan(0.8);
    // 표본이 0이면 전 구간.
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});
