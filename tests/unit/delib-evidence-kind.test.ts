/**
 * Q1 근거 유형 자기 태깅 (DELIBERATION-QUALITY-PLAN §2 Q1) 단위 테스트.
 *
 * 검증 범위:
 *  - 제출·저장·조회 왕복 (participant / operator 대리입력)
 *  - 미지정 허용 (선택은 선택사항 — 강제하면 제출 마찰)
 *  - 잘못된 값 거부 (zod enum + DB check constraint 이중 방어 중 1차)
 *  - 집계 정확성 (라운드별·그룹별 count/비율)
 *  - k-익명 억제 (기여자 3명 미만 그룹)
 *  - fixture/Neon 동작 일치 (컬럼 목록 ↔ insert 플레이스홀더 ↔ 마이그레이션)
 *  - 기존 submit_statement 회귀 없음
 *
 * AX_MODE 강제 fixture (DATABASE_URL 무시) — 기존 delib 테스트와 동일 패턴.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import { updateWorkshopSettings, registerParticipant, submitStatement } from '@/lib/action/handlers/delib';
import { statements } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import {
  computeEvidenceKindDistribution,
  computeEvidenceKindByRound,
  type EvidenceKindItem
} from '@/lib/delib/metrics';
import type { AxActionEnvelope } from '@/lib/action/envelope';

const SID = 'se-001-DEMO';

function env(action: string, role: 'instructor' | 'participant', input: unknown, sessionId = SID): AxActionEnvelope {
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

async function confirmConsent(): Promise<void> {
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', 'instructor', {
      sessionId: SID,
      anonymousMode: false,
      disclosure: 'participants',
      retentionDays: 30,
      minorSession: false,
      consentConfirmed: true
    })
  });
}

async function newParticipant(alias = 'p'): Promise<string> {
  const r = await registerParticipant({ envelope: env('delib.register_participant', 'instructor', { sessionId: SID, displayAlias: alias }) });
  return (r.data as { participantId: string }).participantId;
}

describe('Q1 근거 유형 — 제출·저장·조회 왕복 (fixture)', () => {
  beforeEach(async () => {
    resetStore();
    await confirmConsent();
  });

  it('참가자 제출 — evidenceKind 가 저장되고 그대로 조회된다', async () => {
    const pid = await newParticipant('가A');
    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '직접 겪은 일입니다', evidenceKind: 'experience' }),
      trusted: { participantId: pid }
    });
    const sid = (r.data as { statementId: string }).statementId;
    const row = await statements.findById(adminContext(SID), sid);
    expect(row?.evidence_kind).toBe('experience');
    // 목록 조회 경로에서도 동일하게 보인다.
    const list = await statements.list(adminContext(SID), SID);
    expect(list.find((s) => s.id === sid)?.evidence_kind).toBe('experience');
  });

  it('3종 값 모두 왕복한다', async () => {
    for (const kind of ['experience', 'source', 'estimate'] as const) {
      const r = await submitStatement({
        envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: `의견 ${kind}`, evidenceKind: kind })
      });
      const row = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
      expect(row?.evidence_kind).toBe(kind);
    }
  });

  it('미지정 허용 — evidenceKind 없이 제출하면 null 로 저장된다', async () => {
    const r = await submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: '태그 없는 의견' }) });
    const row = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(row?.evidence_kind).toBeNull();
  });

  it('대리입력(operator) 경로에서는 evidenceKind 를 null 로 강제한다', async () => {
    const pid = await newParticipant('가B');
    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'instructor', {
        sessionId: SID, authorParticipantId: pid, body: '종이 제출 대리입력', evidenceKind: 'source'
      })
    });
    const row = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(row?.evidence_kind).toBeNull();
    expect(row?.author_participant_id).toBe(pid);
  });

  it('잘못된 값은 거부한다', async () => {
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: 'x', evidenceKind: 'fact' }) })
    ).rejects.toThrow();
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: 'x', evidenceKind: '' }) })
    ).rejects.toThrow();
  });

  it('회귀 없음 — 기존 submit_statement 동작(신원·필드)이 그대로다', async () => {
    // participant 신원은 여전히 서버 쿠키(trusted)만 신뢰한다 — input.authorParticipantId 는 무시.
    const real = await newParticipant('진짜');
    const other = await newParticipant('사칭대상');
    const r = await submitStatement({
      envelope: env('delib.submit_statement', 'participant', {
        sessionId: SID, authorParticipantId: other, body: '사칭 시도', evidenceKind: 'estimate'
      }),
      trusted: { participantId: real }
    });
    const row = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(row?.author_participant_id).toBe(real);
    expect(row?.visibility).toBe('group');
    expect(row?.moderation_state).toBe('visible');
    // 신원 없는 participant 는 여전히 거부.
    await expect(
      submitStatement({ envelope: env('delib.submit_statement', 'participant', { sessionId: SID, body: '익명 시도' }) })
    ).rejects.toThrow(/participant identity required/);
  });
});

// 집계 대상: 서로 다른 기여자 3명 이상이어야 억제되지 않는다.
function item(
  statementId: string,
  evidenceKind: EvidenceKindItem['evidenceKind'],
  opts: { groupId?: string | null; roundId?: string | null; author?: string | null } = {}
): EvidenceKindItem {
  return {
    statementId,
    evidenceKind,
    groupId: opts.groupId ?? null,
    roundId: opts.roundId ?? null,
    authorParticipantId: opts.author ?? null
  };
}

describe('Q1 근거 유형 — 집계 정확성', () => {
  it('전체 분포 count/비율 계산', () => {
    const items = [
      item('s1', 'experience', { author: 'p1' }),
      item('s2', 'experience', { author: 'p2' }),
      item('s3', 'experience', { author: 'p3' }),
      item('s4', 'source', { author: 'p4' }),
      item('s5', 'source', { author: 'p5' }),
      item('s6', 'source', { author: 'p6' }),
      item('s7', 'estimate', { author: 'p7' }),
      item('s8', 'estimate', { author: 'p8' }),
      item('s9', 'estimate', { author: 'p9' }),
      item('s10', null, { author: 'p10' }),
      item('s11', null, { author: 'p11' }),
      item('s12', null, { author: 'p12' })
    ];
    const b = computeEvidenceKindDistribution(items);
    expect(b.overall.suppressed).toBe(false);
    expect(b.overall.total).toBe(12);
    expect(b.overall.tagged).toBe(9);
    expect(b.overall.counts).toEqual({ experience: 3, source: 3, estimate: 3, unspecified: 3 });
    expect(b.overall.ratios.estimate).toBeCloseTo(0.25);
    expect(b.overall.ratios.unspecified).toBeCloseTo(0.25);
  });

  it('그룹별 분포 — 그룹 미배정 발언은 overall 에만 포함', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'estimate', { groupId: 'g1', author: 'p2' }),
      item('s3', 'estimate', { groupId: 'g1', author: 'p3' }),
      item('s4', 'source', { groupId: 'g1', author: 'p4' }),
      item('s5', 'source', { groupId: 'g1', author: 'p5' }),
      item('s6', 'source', { groupId: 'g1', author: 'p6' }),
      item('s7', 'experience', { groupId: null, author: 'p7' }),
      item('s8', 'experience', { groupId: null, author: 'p8' }),
      item('s9', 'experience', { groupId: null, author: 'p9' })
    ];
    const b = computeEvidenceKindDistribution(items);
    expect(b.overall.suppressed).toBe(false);
    expect(b.overall.total).toBe(9);
    expect(b.byGroup.length).toBe(1);
    const g1 = b.byGroup[0].distribution;
    expect(g1.suppressed).toBe(false);
    expect(g1.total).toBe(6);
    expect(g1.counts.estimate).toBe(3);
    expect(g1.ratios.estimate).toBeCloseTo(0.5);
  });

  it('라운드별 분포 — 라운드 미지정은 별도 버킷', () => {
    const items = [
      item('s1', 'experience', { roundId: 'r1', author: 'p1' }),
      item('s2', 'experience', { roundId: 'r1', author: 'p2' }),
      item('s3', 'experience', { roundId: 'r1', author: 'p3' }),
      item('s4', 'estimate', { roundId: 'r1', author: 'p4' }),
      item('s5', 'estimate', { roundId: 'r1', author: 'p5' }),
      item('s6', 'estimate', { roundId: 'r1', author: 'p6' }),
      item('s7', 'source', { roundId: null, author: 'p7' })
    ];
    const rounds = computeEvidenceKindByRound(items);
    const r1 = rounds.find((r) => r.roundId === 'r1')!;
    expect(r1.overall.suppressed).toBe(false);
    expect(r1.overall.total).toBe(6);
    expect(r1.overall.counts.estimate).toBe(3);
    const none = rounds.find((r) => r.roundId === null)!;
    // 기여자 1명이므로 억제되고 수치는 0 으로 마스킹된다.
    expect(none.overall.suppressed).toBe(true);
    expect(none.overall.total).toBe(0);
  });

  it('빈 입력은 억제 아님(정보 없음) + 수치 0', () => {
    const b = computeEvidenceKindDistribution([]);
    expect(b.overall.total).toBe(0);
    expect(b.overall.suppressed).toBe(false);
    expect(b.byGroup.length).toBe(0);
  });
});

describe('Q1 근거 유형 — k-익명 억제 (개인 단위 노출 금지)', () => {
  it('그룹 기여자 3명 미만이면 억제 — 수치 전부 마스킹', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'estimate', { groupId: 'g1', author: 'p2' })
    ];
    const b = computeEvidenceKindDistribution(items);
    const g1 = b.byGroup.find((g) => g.groupId === 'g1')!.distribution;
    expect(g1.suppressed).toBe(true);
    expect(g1.suppressionReason).toBe('contributors');
    expect(g1.total).toBe(0);
    expect(g1.counts).toEqual({ experience: 0, source: 0, estimate: 0, unspecified: 0 });
    expect(g1.ratios).toEqual({ experience: 0, source: 0, estimate: 0, unspecified: 0 });
  });

  it('발언 수가 많아도 기여자가 1명이면 억제 (발언 수로 우회 불가)', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s3', 'source', { groupId: 'g1', author: 'p1' }),
      item('s4', 'experience', { groupId: 'g1', author: 'p1' })
    ];
    const g1 = computeEvidenceKindDistribution(items).byGroup[0].distribution;
    expect(g1.contributors).toBe(1);
    expect(g1.suppressed).toBe(true);
    expect(g1.suppressionReason).toBe('contributors');
  });

  it('작성자 미상(대리입력)은 하나의 기여자로 묶어 보수적으로 판정한다', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: null }),
      item('s2', 'source', { groupId: 'g1', author: null }),
      item('s3', 'experience', { groupId: 'g1', author: null })
    ];
    const g1 = computeEvidenceKindDistribution(items).byGroup[0].distribution;
    expect(g1.contributors).toBe(1);
    expect(g1.suppressed).toBe(true);
    expect(g1.suppressionReason).toBe('contributors');
  });

  it('임계값은 옵션으로 조정 가능 (기본 3)', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'source', { groupId: 'g1', author: 'p1' }),
      item('s3', 'estimate', { groupId: 'g1', author: 'p2' }),
      item('s4', 'source', { groupId: 'g1', author: 'p2' })
    ];
    expect(computeEvidenceKindDistribution(items).byGroup[0].distribution.suppressed).toBe(true);
    expect(computeEvidenceKindDistribution(items, { kAnonymityThreshold: 2 }).byGroup[0].distribution.suppressed).toBe(false);
  });

  it('비영 셀이 k 미만이면 기여자가 충분해도 분포 전체를 억제한다', () => {
    const items = [
      item('s1', 'experience', { groupId: 'g1', author: 'p1' }),
      item('s2', 'experience', { groupId: 'g1', author: 'p2' }),
      item('s3', 'experience', { groupId: 'g1', author: 'p3' }),
      item('s4', 'estimate', { groupId: 'g1', author: 'p4' })
    ];
    const g1 = computeEvidenceKindDistribution(items).byGroup[0].distribution;
    expect(g1.contributors).toBe(4);
    expect(g1.suppressed).toBe(true);
    expect(g1.suppressionReason).toBe('small_cell');
    expect(g1.total).toBe(0);
  });

  it('억제 그룹이 있으면 overall 도 억제해 차분 복원을 막는다', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'estimate', { groupId: 'g1', author: 'p2' }),
      item('s3', 'source', { groupId: 'g2', author: 'p3' }),
      item('s4', 'source', { groupId: 'g2', author: 'p4' }),
      item('s5', 'source', { groupId: 'g2', author: 'p5' }),
      item('s6', 'estimate', { groupId: 'g2', author: 'p6' }),
      item('s7', 'estimate', { groupId: 'g2', author: 'p7' }),
      item('s8', 'estimate', { groupId: 'g2', author: 'p8' })
    ];
    const b = computeEvidenceKindDistribution(items);
    expect(b.overall.suppressed).toBe(true);
    expect(b.overall.suppressionReason).toBe('group_residual');
  });

  it('억제 그룹이 하나뿐이면 가장 작은 공개 그룹을 보완 억제한다', () => {
    const items = [
      item('s1', 'estimate', { groupId: 'g1', author: 'p1' }),
      item('s2', 'estimate', { groupId: 'g1', author: 'p2' }),
      item('s3', 'source', { groupId: 'g2', author: 'p3' }),
      item('s4', 'source', { groupId: 'g2', author: 'p4' }),
      item('s5', 'source', { groupId: 'g2', author: 'p5' }),
      item('s6', 'estimate', { groupId: 'g2', author: 'p6' }),
      item('s7', 'estimate', { groupId: 'g2', author: 'p7' }),
      item('s8', 'estimate', { groupId: 'g2', author: 'p8' }),
      item('s9', 'experience', { groupId: 'g3', author: 'p9' }),
      item('s10', 'experience', { groupId: 'g3', author: 'p10' }),
      item('s11', 'experience', { groupId: 'g3', author: 'p11' }),
      item('s12', 'source', { groupId: 'g3', author: 'p12' }),
      item('s13', 'source', { groupId: 'g3', author: 'p13' }),
      item('s14', 'source', { groupId: 'g3', author: 'p14' }),
      item('s15', 'estimate', { groupId: 'g3', author: 'p15' }),
      item('s16', 'estimate', { groupId: 'g3', author: 'p16' }),
      item('s17', 'estimate', { groupId: 'g3', author: 'p17' })
    ];
    const b = computeEvidenceKindDistribution(items);
    expect(b.byGroup.find((g) => g.groupId === 'g1')!.distribution.suppressionReason).toBe('contributors');
    expect(b.byGroup.find((g) => g.groupId === 'g2')!.distribution.suppressionReason).toBe('complementary');
    expect(b.byGroup.find((g) => g.groupId === 'g3')!.distribution.suppressed).toBe(false);
  });
});

describe('Q1 근거 유형 — fixture/Neon 이원화 방어', () => {
  const repoSrc = readFileSync(resolve(process.cwd(), 'lib/db/repo/statements.ts'), 'utf8');
  const helpersSrc = readFileSync(resolve(process.cwd(), 'lib/db/neonHelpers.ts'), 'utf8');
  const migration = readFileSync(resolve(process.cwd(), 'db/migrations/0018_statement_evidence_kind.sql'), 'utf8');

  it('마이그레이션이 evidence_kind 컬럼 + check constraint 를 정의한다', () => {
    expect(migration).toMatch(/alter table statements add column if not exists evidence_kind text/);
    expect(migration).toMatch(/evidence_kind in \('experience', 'source', 'estimate'\)/);
    // nullable 이어야 한다 (기존 행·대리입력 호환) — not null 선언 금지.
    expect(migration).not.toMatch(/evidence_kind text not null/);
  });

  it('COLS.statements 에 evidence_kind 가 포함된다 (Neon select 가 fixture 와 같은 필드를 돌려준다)', () => {
    const cols = helpersSrc.match(/statements: '([^']+)'/)?.[1] ?? '';
    expect(cols.split(',').map((c) => c.trim())).toContain('evidence_kind');
  });

  it('Neon insert 플레이스홀더 수 = COLS.statements 컬럼 수 (이원화 드리프트 차단)', () => {
    const cols = helpersSrc.match(/statements: '([^']+)'/)?.[1] ?? '';
    const colCount = cols.split(',').length;
    const placeholders = repoSrc.match(/insert into statements \(\$\{COLS\.statements\}\) values \(([^)]+)\)/)?.[1] ?? '';
    expect(placeholders.split(',').length).toBe(colCount);
    // 마지막 값은 evidence_kind (컬럼 목록 순서와 일치).
    expect(repoSrc).toMatch(/row\.created_at, row\.evidence_kind\]/);
  });

  it('fixture 경로도 evidence_kind 를 null 기본값으로 채운다', async () => {
    resetStore();
    await confirmConsent();
    const r = await submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, body: 'fixture 기본값' }) });
    const row = await statements.findById(adminContext(SID), (r.data as { statementId: string }).statementId);
    expect(row).toBeDefined();
    expect('evidence_kind' in (row as object)).toBe(true);
    expect(row?.evidence_kind).toBeNull();
  });
});
