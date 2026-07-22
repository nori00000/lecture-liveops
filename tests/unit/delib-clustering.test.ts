import { describe, it, expect } from 'vitest';
import {
  buildVoteMatrix,
  filterByMinVotes,
  imputeMeans,
  kmeans,
  pca2d,
  silhouetteScore,
  voteCounts,
  type VoteRecord
} from '@/lib/delib/clustering';
import { computeLandscape } from '@/lib/delib/landscapeMetrics';

// ------------------------------------------------------------
// 합성 데이터 생성기 — 난수 없이 인덱스 규칙만 쓴다(테스트도 결정론적).
// blocs 개 진영이 statementCount 개 발언에 대해 서로 반대로 투표한다.
// ------------------------------------------------------------
function synth(opts: {
  participants: number;
  statements: number;
  blocs: number;
  // 진영 신호를 흐리는 소수의 이탈표 (인덱스 규칙으로 결정론적).
  noiseEvery?: number;
}): { votes: VoteRecord[]; statementIds: string[]; participantIds: string[] } {
  const { participants, statements, blocs } = opts;
  const noiseEvery = opts.noiseEvery ?? 0;
  const statementIds = Array.from({ length: statements }, (_, j) => `s${String(j).padStart(3, '0')}`);
  const participantIds = Array.from({ length: participants }, (_, i) => `p${String(i).padStart(3, '0')}`);
  const votes: VoteRecord[] = [];
  for (let i = 0; i < participants; i += 1) {
    const bloc = i % blocs;
    for (let j = 0; j < statements; j += 1) {
      // 발언 j 는 (j % blocs) 진영이 찬성, 나머지는 반대. j=0 은 전 진영 공통 찬성.
      let agree = j === 0 ? true : j % blocs === bloc;
      if (noiseEvery > 0 && (i * 31 + j * 17) % noiseEvery === 0) agree = !agree;
      votes.push({ participantId: participantIds[i], statementId: statementIds[j], vote: agree ? 'agree' : 'disagree' });
    }
  }
  return { votes, statementIds, participantIds };
}

describe('delib clustering — 투표행렬 / 결측 대체', () => {
  it('buildVoteMatrix — agree=+1 / disagree=-1 / pass=0 / 미투표=null, id 는 정렬 고정', () => {
    const votes: VoteRecord[] = [
      { participantId: 'pB', statementId: 's2', vote: 'agree' },
      { participantId: 'pA', statementId: 's1', vote: 'disagree' },
      { participantId: 'pA', statementId: 's2', vote: 'pass' }
    ];
    const m = buildVoteMatrix(votes, ['s2', 's1'], ['pB', 'pA']);
    expect(m.participantIds).toEqual(['pA', 'pB']);
    expect(m.statementIds).toEqual(['s1', 's2']);
    expect(m.values).toEqual([
      [-1, 0],
      [null, 1]
    ]);
  });

  it('voteCounts / filterByMinVotes — 최소 투표 수 미만 참가자 제외', () => {
    const votes: VoteRecord[] = [
      ...['s1', 's2', 's3'].map((s) => ({ participantId: 'pFull', statementId: s, vote: 'agree' as const })),
      { participantId: 'pThin', statementId: 's1', vote: 'agree' }
    ];
    const m = buildVoteMatrix(votes, ['s1', 's2', 's3'], ['pFull', 'pThin']);
    expect(voteCounts(m)).toEqual([3, 1]);
    const kept = filterByMinVotes(m, 3);
    expect(kept.participantIds).toEqual(['pFull']);
  });

  it('imputeMeans — 결측치는 해당 statement(열) 관측 평균으로 대체', () => {
    const m = buildVoteMatrix(
      [
        { participantId: 'p1', statementId: 's1', vote: 'agree' },
        { participantId: 'p2', statementId: 's1', vote: 'disagree' },
        { participantId: 'p3', statementId: 's1', vote: 'agree' }
        // p4 는 s1 미투표 → 평균 (1 + -1 + 1)/3 = 0.3333
      ],
      ['s1'],
      ['p1', 'p2', 'p3', 'p4']
    );
    const imputed = imputeMeans(m);
    expect(imputed[3][0]).toBeCloseTo(1 / 3, 10);
  });

  it('imputeMeans — 관측이 하나도 없는 발언은 0 으로 채운다', () => {
    const m = buildVoteMatrix([], ['s1', 's2'], ['p1']);
    expect(imputeMeans(m)).toEqual([[0, 0]]);
  });
});

describe('delib clustering — PCA 수치 정확성', () => {
  it('완전 상관 2열 행렬 — 제1주성분은 (1/√2, 1/√2), 제2고유값은 0', () => {
    const rows = [
      [-2, -2],
      [-1, -1],
      [0, 0],
      [1, 1],
      [2, 2]
    ];
    const r = pca2d(rows);
    // 공분산 = [[2.5,2.5],[2.5,2.5]] → λ1 = 5, λ2 = 0.
    expect(r.eigenvalues[0]).toBeCloseTo(5, 6);
    expect(r.eigenvalues[1]).toBeCloseTo(0, 6);
    expect(r.components[0][0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(r.components[0][1]).toBeCloseTo(Math.SQRT1_2, 6);
    // 투영값 = 중심화행 · v1. 첫 행 (-2,-2) → -2√2.
    expect(r.points[0].x).toBeCloseTo(-2 * Math.SQRT2, 6);
    expect(r.points[2].x).toBeCloseTo(0, 6);
    expect(r.points[4].x).toBeCloseTo(2 * Math.SQRT2, 6);
    // y 축(제2주성분)은 분산이 없으므로 전부 0.
    for (const p of r.points) expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it('축 정렬 데이터 — 분산이 큰 축이 제1주성분 (λ = 각 축 표본분산)', () => {
    // 두 열의 공분산이 0 이 되도록 배치 → 고유값이 각 열의 표본분산과 같아진다.
    const rows = [
      [-3, -1],
      [-1, 1],
      [1, 1],
      [3, -1]
    ];
    const r = pca2d(rows);
    // 열1 표본분산 = (9+1+1+9)/3 = 6.667, 열2 = (1+1+1+1)/3 = 1.333, 공분산 = (3-1+1-3)/3 = 0
    expect(r.eigenvalues[0]).toBeCloseTo(20 / 3, 6);
    expect(r.eigenvalues[1]).toBeCloseTo(4 / 3, 6);
    expect(Math.abs(r.components[0][0])).toBeCloseTo(1, 6);
    expect(Math.abs(r.components[1][1])).toBeCloseTo(1, 6);
  });

  it('부호 규약 — 입력 순서를 바꿔도 주성분 부호가 고정된다', () => {
    const rows = [
      [-2, -2],
      [2, 2]
    ];
    const a = pca2d(rows);
    const b = pca2d([...rows].reverse());
    expect(a.components[0]).toEqual(b.components[0]);
  });
});

describe('delib clustering — k-means / 실루엣', () => {
  it('명확히 분리된 두 덩어리를 정확히 나눈다 (centroid x 오름차순 라벨)', () => {
    const points = [
      { x: -10, y: 0 },
      { x: -9.5, y: 0.5 },
      { x: -10.5, y: -0.5 },
      { x: 10, y: 0 },
      { x: 9.5, y: 0.5 },
      { x: 10.5, y: -0.5 }
    ];
    const km = kmeans(points, 2);
    expect(km.labels.slice(0, 3)).toEqual([0, 0, 0]);
    expect(km.labels.slice(3)).toEqual([1, 1, 1]);
    expect(km.centroids[0].x).toBeLessThan(km.centroids[1].x);
    expect(silhouetteScore(points, km.labels, 2)).toBeGreaterThan(0.9);
  });

  it('결정론 — 같은 입력 100회 실행 시 동일 라벨/중심', () => {
    const points = Array.from({ length: 40 }, (_, i) => ({ x: (i % 4) * 5 + i * 0.01, y: ((i * 7) % 9) * 0.3 }));
    const first = JSON.stringify(kmeans(points, 3));
    for (let i = 0; i < 100; i += 1) expect(JSON.stringify(kmeans(points, 3))).toBe(first);
  });
});

describe('delib landscape — 소규모 게이트', () => {
  it('유효 참가자 59명 → 클러스터링 비활성 (participants_below_minimum)', () => {
    const data = synth({ participants: 59, statements: 10, blocs: 2 });
    const r = computeLandscape(data);
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('participants_below_minimum');
    expect(r.eligibleCount).toBe(59);
    expect(r.clusters).toEqual([]);
    expect(r.projection).toEqual([]);
  });

  // C6(2026-07-22): 60~99명 k=2 고정 정책은 진짜 3분할을 뭉갰다 (실측: k=2 실루엣 0.532/크기[20,40]
  // vs k=3 0.836/크기[20,20,20]). "클러스터당 20~30" 문헌은 최소 크기 근거이지 k 상한 근거가 아니다.
  // → n≥60 이면 k∈{2,3}, n≥100 이면 k∈{2..5}. 클러스터당 20명 규칙은 유지.
  it('60명 3진영 → k∈{2,3} 중에서 선택 (구 정책의 k=2 고정 폐기)', () => {
    const data = synth({ participants: 60, statements: 10, blocs: 3, noiseEvery: 23 });
    const r = computeLandscape(data);
    expect(r.enabled).toBe(true);
    expect(r.k).toBe(3);
    expect(r.clusters).toHaveLength(3);
    for (const c of r.clusters) expect(c.size).toBeGreaterThanOrEqual(20);
  });

  it('99명 → k 상한 3, 100명 → k 를 2~5 중에서 선택', () => {
    const small = computeLandscape(synth({ participants: 99, statements: 12, blocs: 3, noiseEvery: 23 }));
    expect(small.enabled).toBe(true);
    expect(small.k).toBeLessThanOrEqual(3);
    const large = computeLandscape(synth({ participants: 100, statements: 12, blocs: 3, noiseEvery: 23 }));
    expect(large.enabled).toBe(true);
    expect(large.k).toBeGreaterThanOrEqual(2);
    expect(large.k).toBeLessThanOrEqual(5);
  });

  it('클러스터당 20명 미만이 되는 k 는 배제된다', () => {
    const data = synth({ participants: 100, statements: 12, blocs: 4, noiseEvery: 23 });
    const r = computeLandscape(data);
    expect(r.enabled).toBe(true);
    for (const c of r.clusters) expect(c.size).toBeGreaterThanOrEqual(20);
    // 최소 클러스터 크기를 40 으로 올리면 100명 기준 k=2 만 가능(k=3 은 33명).
    // (2진영 데이터로 50/50 분할이 나오게 해 k=2 자체는 유효하도록 둔다.)
    const forced = computeLandscape(synth({ participants: 100, statements: 12, blocs: 2, noiseEvery: 23 }), { minClusterSize: 40 });
    expect(forced.enabled).toBe(true);
    expect(forced.k).toBe(2);
    for (const c of forced.clusters) expect(c.size).toBeGreaterThanOrEqual(40);
  });

  it('만족하는 k 가 하나도 없으면 no_valid_k 로 비활성', () => {
    const data = synth({ participants: 60, statements: 10, blocs: 2 });
    const r = computeLandscape(data, { minClusterSize: 40 }); // 60/2 = 30 < 40
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('no_valid_k');
  });

  it('최소 7표 미만 투표한 참가자는 클러스터링에서 제외된다', () => {
    const base = synth({ participants: 70, statements: 10, blocs: 2 });
    // 뒤쪽 10명은 6표만 남기고 잘라낸다 → 유효 참가자 60명.
    const thin = new Set(base.participantIds.slice(60));
    const votes = base.votes.filter((v) => {
      if (!thin.has(v.participantId)) return true;
      return Number(v.statementId.slice(1)) < 6; // 6표만 유지
    });
    const r = computeLandscape({ ...base, votes });
    expect(r.participantCount).toBe(70);
    expect(r.eligibleCount).toBe(60);
    expect(r.clusters.reduce((a, c) => a + c.size, 0)).toBe(60);
  });

  it('발언 2건 미만이면 insufficient_statements', () => {
    const base = synth({ participants: 100, statements: 1, blocs: 2 });
    const r = computeLandscape(base, { minVotesPerParticipant: 1 });
    expect(r.enabled).toBe(false);
    expect(r.reason).toBe('insufficient_statements');
  });
});

describe('delib landscape — 결정론', () => {
  it('같은 입력 100회 → 완전히 동일한 출력', () => {
    const data = synth({ participants: 120, statements: 14, blocs: 3, noiseEvery: 23 });
    const first = JSON.stringify(computeLandscape(data));
    for (let i = 0; i < 100; i += 1) {
      expect(JSON.stringify(computeLandscape(data))).toBe(first);
    }
  });

  it('입력 배열 순서를 섞어도 동일한 출력 (정렬 기반 결정론)', () => {
    const data = synth({ participants: 100, statements: 12, blocs: 2, noiseEvery: 23 });
    const shuffled = {
      // 결정론적 셔플 (인덱스 규칙).
      votes: data.votes.filter((_, i) => i % 2 === 1).concat(data.votes.filter((_, i) => i % 2 === 0)),
      statementIds: [...data.statementIds].reverse(),
      participantIds: [...data.participantIds].reverse()
    };
    expect(JSON.stringify(computeLandscape(shuffled))).toBe(JSON.stringify(computeLandscape(data)));
  });
});

describe('delib landscape — 프라이버시', () => {
  it('projection 에 participantId 가 포함되지 않는다', () => {
    const data = synth({ participants: 100, statements: 12, blocs: 2, noiseEvery: 23 });
    const r = computeLandscape(data);
    expect(r.enabled).toBe(true);
    expect(r.projection.length).toBe(r.eligibleCount);
    for (const p of r.projection) {
      expect(Object.keys(p).sort()).toEqual(['cluster', 'x', 'y']);
    }
    const serialized = JSON.stringify(r);
    for (const pid of data.participantIds) expect(serialized).not.toContain(pid);
  });

  it('projection 은 (클러스터, x, y) 정렬 순 — 배열 인덱스로 참가자를 역추적할 수 없다', () => {
    const r = computeLandscape(synth({ participants: 100, statements: 12, blocs: 2, noiseEvery: 23 }));
    for (let i = 1; i < r.projection.length; i += 1) {
      const a = r.projection[i - 1];
      const b = r.projection[i];
      expect(a.cluster < b.cluster || (a.cluster === b.cluster && a.x <= b.x)).toBe(true);
    }
  });
});

describe('delib landscape — GIC / 대표의견', () => {
  // 두 진영 4명씩. s000 은 전원 찬성(공통), s001/s003 은 A 진영만 찬성, s002 는 B 진영만 찬성.
  // 소표본 픽스처이므로 노출 임계(H3)를 테스트 규모에 맞춰 낮춘다 — 임계 자체의 검증은
  // delib-landscape-stats.test.ts 가 실제 규모(120명)에서 담당한다.
  const smallOptions = {
    minVotesPerParticipant: 4,
    minParticipants: 8,
    largeSessionThreshold: 1000,
    minClusterSize: 4,
    kAnonymityThreshold: 3,
    gicMinClusterVotesAbsolute: 3,
    gicMinClusterVotesFraction: 0.2,
    representativeMinVotesAbsolute: 3,
    representativeMinVotesFraction: 0.3
  };
  const data = synth({ participants: 8, statements: 4, blocs: 2 });

  it('GIC — 그룹별 라플라스 스무딩 찬성확률의 기하평균 (수기 계산과 일치)', () => {
    const r = computeLandscape(data, smallOptions);
    expect(r.enabled).toBe(true);
    expect(r.k).toBe(2);
    expect(r.clusters.map((c) => c.size)).toEqual([4, 4]);

    // H4: 곱 → 기하평균. 곱은 k 가 커질수록 값이 작아져 세션 간 비교가 불가능했다
    // (전 그룹 90% 찬성인 동일 발언: k=2 에서 0.746, k=5 에서 0.481, k=8 에서 0.310).
    // 공통 발언 s000: 두 그룹 모두 4/4 찬성 → ((5/6)×(5/6))^(1/2) = 5/6.
    const common = r.gic.find((g) => g.statementId === 's000');
    expect(common).toBeDefined();
    expect(common!.score).toBeCloseTo(5 / 6, 12);
    // 양극화 발언 s001: 한쪽 4/4 찬성, 다른쪽 0/4 → ((5/6)×(1/6))^(1/2) = 0.37268...
    const polarized = r.gic.find((g) => g.statementId === 's001');
    expect(polarized!.score).toBeCloseTo(Math.sqrt((5 / 6) * (1 / 6)), 12);
    // 전 그룹 고른 찬성이 1위 (다수 횡포 방지).
    expect(r.gic[0].statementId).toBe('s000');
    // H4: 그룹별 표본과 Wilson CI 를 병기한다.
    expect(common!.perCluster).toHaveLength(2);
    for (const c of common!.perCluster) {
      expect(c.votes).toBe(4);
      expect(c.agreeRate).toBe(1);
      expect(c.ciLow).toBeLessThanOrEqual(1);
      expect(c.ciHigh).toBe(1);
    }
  });

  it('GIC — 유효표가 k-익명 임계 미만인 발언은 제외된다', () => {
    // s003 에 대한 표를 2건만 남긴다 (임계 3 미만).
    const votes = data.votes.filter((v) => v.statementId !== 's003' || ['p000', 'p001'].includes(v.participantId));
    const r = computeLandscape({ ...data, votes }, { ...smallOptions, minVotesPerParticipant: 3 });
    expect(r.enabled).toBe(true);
    expect(r.gic.some((g) => g.statementId === 's003')).toBe(false);
  });

  it('대표 의견 — 그룹 안/밖 찬성률 차이(lift), 그룹마다 서로 다른 발언이 뽑힌다', () => {
    const r = computeLandscape(data, smallOptions);
    expect(r.representatives.length).toBeGreaterThan(0);
    // C4: lift 는 스무딩 없는 원시 비율 차이다 (검정도 원시 카운트로 한다).
    // 한쪽만 4/4 찬성, 다른쪽 0/4 → lift = 1 - 0 = 1.
    for (const rep of r.representatives) {
      expect(rep.lift).toBeCloseTo(1, 12);
      expect(rep.agreeRate).toBe(1);
      // 소표본이므로 Fisher 정확검정 + BH 보정을 거쳐 유의해야 채택된다.
      expect(rep.test).toBe('fisher');
      expect(rep.pAdjusted).toBeLessThan(0.05);
      // 전원 찬성인 공통 발언은 lift 0 이라 대표의견이 될 수 없다.
      expect(rep.statementId).not.toBe('s000');
    }
    const byCluster = new Map<number, string[]>();
    for (const rep of r.representatives) {
      byCluster.set(rep.clusterId, [...(byCluster.get(rep.clusterId) ?? []), rep.statementId]);
    }
    expect(byCluster.size).toBe(2);
    const [a, b] = [...byCluster.values()];
    expect(a.some((s) => b.includes(s))).toBe(false);
  });

  it('대표 의견 — 그룹 안/밖 표본이 임계 미만이면 억제된다', () => {
    // 모든 발언의 표를 3건 미만으로 만들면 대표의견이 하나도 남지 않는다.
    const votes = data.votes.filter((v) => ['p000', 'p004'].includes(v.participantId) || v.statementId === 's000');
    const r = computeLandscape({ ...data, votes }, { ...smallOptions, minVotesPerParticipant: 1 });
    if (r.enabled) {
      expect(r.representatives).toEqual([]);
    } else {
      expect(r.reason).toBeDefined();
    }
  });
});
