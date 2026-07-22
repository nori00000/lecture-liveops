/**
 * Q2 — 사후 리포트 "검토가 필요한 주장" 단위 테스트 (fixture mode).
 * 근거: docs/DELIBERATION-QUALITY-PLAN.md §2 Q2 · §3 · §5.
 *
 * 검증:
 *  - 승인 전에는 리포트에 실리지 않고, 승인해야 실린다. 기각은 영구 제외.
 *  - provider 실패(도달 불가 엔드포인트)여도 리포트·포맷이 정상 발행된다 (AI 는 크리티컬 패스가 아니다).
 *  - external provider 는 offsiteProcessing 동의 없으면(그리고 env 미설정이면) 서버가 거부한다.
 *  - 참가자는 두 액션 모두 권한 없음.
 *  - stub 규칙은 결정론적이며 hidden 발언은 후보에서 제외된다.
 *
 * 비용 0 원칙: 실제 외부 LLM API 를 호출하지 않는다 (stub + 127.0.0.1 거부 엔드포인트만 사용).
 * AX_MODE 강제 fixture (DATABASE_URL 무시).
 */

import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import {
  updateWorkshopSettings,
  createWorkshop,
  registerParticipant,
  submitStatement,
  moderateStatement,
  computeSnapshot,
  computeAiObservations,
  reviewAiObservation
} from '@/lib/action/handlers/delib';
import { isAllowed } from '@/lib/action/permissions';
import { listCatalog } from '@/lib/action/catalog';
import { stubAnalyze, resolveProvider } from '@/lib/delib/aiProvider';
import { buildWorkshopReport } from '@/lib/delib/report';
import { planDelibMarkdownDocument, planDelibHtmlExport } from '@/lib/delib/reportFormats';
import { aiObservations } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';
import type { EvidenceKind } from '@/lib/db/schema';

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

async function confirmConsent(opts: { offsiteProcessing?: boolean } = {}): Promise<void> {
  const offsite = opts.offsiteProcessing === true;
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', 'instructor', {
      sessionId: SID, anonymousMode: false, disclosure: 'operators_only', retentionDays: 30,
      minorSession: false, consentConfirmed: true,
      // 오프사이트 처리는 녹음 동의를 전제한다 (기존 정합성 규칙).
      recordingConsent: offsite, offsiteProcessing: offsite
    })
  });
}

async function bootRound(): Promise<string> {
  const r = await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title: 'R0' }) });
  return (r.data as { roundId: string }).roundId;
}

async function newStatement(roundId: string, body: string, evidenceKind?: EvidenceKind): Promise<string> {
  const r = await submitStatement({
    envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, roundId, body, evidenceKind })
  });
  return (r.data as { statementId: string }).statementId;
}

async function newParticipantStatement(roundId: string, n: number, body: string, evidenceKind?: EvidenceKind): Promise<string> {
  const p = await registerParticipant({
    envelope: env('delib.register_participant', 'instructor', { sessionId: SID, displayAlias: `참가자${n}`, anonHandle: `anon-${n}` })
  });
  const participantId = (p.data as { participantId: string }).participantId;
  const r = await submitStatement({
    envelope: env('delib.submit_statement', 'participant', { sessionId: SID, roundId, body, evidenceKind }),
    trusted: { participantId }
  });
  return (r.data as { statementId: string }).statementId;
}

// 후보를 만들어내는 발언 3종 + 만들지 않는 발언 1종.
const ASSERTIVE_BODY = '이건 당연히 예산을 늘려야 합니다';
const AMBIGUOUS_BODY = '공정한 배분이 필요합니다';
const SOURCED_NUMERIC_BODY = '작년보다 30% 늘었다는 통계가 있습니다';

async function computeCandidates(input: Record<string, unknown> = {}) {
  const r = await computeAiObservations({ envelope: env('delib.compute_ai_observations', 'instructor', { sessionId: SID, ...input }) });
  return r.data as { provider: string; analyzedCount: number; candidateCount: number };
}

describe('Q2 검토 후보 (fixture mode)', () => {
  beforeEach(async () => {
    resetStore();
    delete process.env.DELIB_AI_PROVIDER;
    delete process.env.DELIB_LOCAL_LLM_URL;
    delete process.env.DELIB_EXTERNAL_LLM_URL;
    delete process.env.DELIB_EXTERNAL_LLM_API_KEY;
    await confirmConsent();
  });

  afterEach(() => {
    delete process.env.DELIB_AI_PROVIDER;
    delete process.env.DELIB_LOCAL_LLM_URL;
    delete process.env.DELIB_EXTERNAL_LLM_URL;
    delete process.env.DELIB_EXTERNAL_LLM_API_KEY;
  });

  it('기본 provider 는 stub 이고 규칙은 결정론적이다 (LLM 호출 0)', async () => {
    expect(resolveProvider()).toBe('stub');
    const input = [
      { id: 'st-1', body: ASSERTIVE_BODY, evidenceKind: null },
      { id: 'st-2', body: AMBIGUOUS_BODY, evidenceKind: null },
      // 자료·출처로 태깅된 수치 주장은 근거 확인 후보가 아니다 (evidence 게이트).
      { id: 'st-3', body: SOURCED_NUMERIC_BODY, evidenceKind: 'source' as EvidenceKind }
    ];
    const a = stubAnalyze(input);
    const b = stubAnalyze(input);
    expect(a).toEqual(b); // 같은 입력 → 같은 출력
    expect(a.map((c) => `${c.statementId}:${c.kind}`)).toEqual(['st-1:evidence_check', 'st-2:definition_mismatch']);
    // 개인·진영 라벨 없이 "확인이 필요" 톤인지.
    expect(a[0].body).toContain('근거 확인이 필요해 보입니다');
    expect(a[0].suggestedQuestion.length).toBeGreaterThan(0);
  });

  it('추정으로 태깅된 수치 주장은 후보가 되지만 자료·출처로 태깅되면 아니다', () => {
    const estimate = stubAnalyze([{ id: 'st-1', body: SOURCED_NUMERIC_BODY, evidenceKind: 'estimate' }]);
    expect(estimate.map((c) => c.kind)).toEqual(['evidence_check']);
    const sourced = stubAnalyze([{ id: 'st-1', body: SOURCED_NUMERIC_BODY, evidenceKind: 'source' }]);
    expect(sourced).toEqual([]);
  });

  it('승인 전에는 리포트에 실리지 않고, 승인해야 실린다', async () => {
    const round = await bootRound();
    const stId = await newStatement(round, ASSERTIVE_BODY);
    const computed = await computeCandidates();
    expect(computed.candidateCount).toBe(1);

    // 승인 전 — 리포트 AI 섹션 비어 있고 md/html 에도 섹션이 없다.
    const before = await buildWorkshopReport(adminContext(SID), SID);
    expect(before!.aiObservations).toEqual([]);
    expect(planDelibMarkdownDocument(before!)).not.toContain('검토가 필요한 주장');
    expect(planDelibHtmlExport(before!)).not.toContain('검토가 필요한 주장');

    // 승인.
    const pending = await aiObservations.list(adminContext(SID), SID, { status: 'pending' });
    expect(pending).toHaveLength(1);
    await reviewAiObservation({ envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[0].id, decision: 'approve' }) });

    const after = await buildWorkshopReport(adminContext(SID), SID);
    expect(after!.aiObservations).toHaveLength(1);
    expect(after!.aiObservations[0].statementId).toBe(stId); // traceability
    const md = planDelibMarkdownDocument(after!);
    expect(md).toContain('검토가 필요한 주장');
    expect(md).toContain('AI 초안'); // §7-5 AI 생성물 라벨
    expect(md).toContain(ASSERTIVE_BODY);
  });

  it('기각한 후보는 영구적으로 리포트에서 제외된다', async () => {
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    await computeCandidates();
    const pending = await aiObservations.list(adminContext(SID), SID, { status: 'pending' });
    await reviewAiObservation({
      envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[0].id, decision: 'reject', reason: '이미 근거가 제시됨' })
    });

    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report!.aiObservations).toEqual([]);
    // 재계산해도 기각 이력은 보존되고, 같은 발언이 다시 후보로 올라오지 않는다.
    await computeCandidates();
    const all = await aiObservations.list(adminContext(SID), SID);
    expect(all.filter((o) => o.status === 'pending')).toHaveLength(0);
    const rejected = all.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].review_reason).toBe('이미 근거가 제시됨'); // §5 오탐 신고율 실측용
    // 이미 검토된 항목의 재판정은 거부된다.
    await expect(
      reviewAiObservation({ envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[0].id, decision: 'approve' }) })
    ).rejects.toThrow(/already reviewed/);
  });

  it('리포트는 Q1/Q2 품질 게이트와 Q5 착수 조건을 집계한다', async () => {
    const round = await bootRound();
    await newParticipantStatement(round, 1, ASSERTIVE_BODY, 'estimate');
    await newParticipantStatement(round, 2, AMBIGUOUS_BODY, 'estimate');
    await newParticipantStatement(round, 3, '추정 기반 추가 의견입니다', 'estimate');
    await newParticipantStatement(round, 4, '자료가 확인된 의견입니다', 'source');
    await newParticipantStatement(round, 5, '출처가 있는 보완 의견입니다', 'source');
    await newParticipantStatement(round, 6, '통계 자료를 확인한 의견입니다', 'source');
    await computeCandidates();
    const pending = await aiObservations.list(adminContext(SID), SID, { status: 'pending' });
    expect(pending).toHaveLength(2);

    await reviewAiObservation({ envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[0].id, decision: 'approve' }) });
    await reviewAiObservation({ envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[1].id, decision: 'reject', reason: '파일럿 오탐' }) });

    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report!.qualityMetrics.q1EstimateTag.estimateRatio).toBeCloseTo(0.5);
    expect(report!.qualityMetrics.q1EstimateTag.status).toBe('pass');
    expect(report!.qualityMetrics.q2ReviewAdoption.reviewedCount).toBe(2);
    expect(report!.qualityMetrics.q2ReviewAdoption.approvedCount).toBe(1);
    expect(report!.qualityMetrics.q2ReviewAdoption.rejectedCount).toBe(1);
    expect(report!.qualityMetrics.q2ReviewAdoption.adoptionRate).toBeCloseTo(0.5);
    expect(report!.qualityMetrics.q2ReviewAdoption.status).toBe('pass');
    expect(report!.qualityMetrics.q5Prerequisite.status).toBe('pass');

    const md = planDelibMarkdownDocument(report!);
    const html = planDelibHtmlExport(report!);
    expect(md).toContain('숙의 품질 게이트');
    expect(md).toContain('Q5 공통지반 요약 착수 조건');
    expect(html).toContain('숙의 품질 게이트');
  });

  it('provider 실패(도달 불가 엔드포인트)여도 리포트는 AI 섹션 없이 정상 발행된다', async () => {
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    // 로컬 엔드포인트가 죽어 있는 상황을 실제로 재현 (외부 호출 0, 비용 0).
    process.env.DELIB_LOCAL_LLM_URL = 'http://127.0.0.1:1';
    const computed = await computeCandidates({ provider: 'local' });
    expect(computed.candidateCount).toBe(0); // throw 하지 않고 빈 결과

    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report).not.toBeNull();
    expect(report!.aiObservations).toEqual([]);
    // 결과 리포트 본문은 그대로 발행된다.
    const md = planDelibMarkdownDocument(report!);
    expect(md).toContain('숙의 워크숍 결과 리포트');
    expect(md).toContain(ASSERTIVE_BODY);
    expect(md).not.toContain('검토가 필요한 주장');
  });

  it('local provider 는 URL 미설정이면 stub 로 폴백한다', async () => {
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    const computed = await computeCandidates({ provider: 'local' });
    expect(computed.candidateCount).toBe(1);
  });

  it('external provider 는 offsiteProcessing 동의가 없으면 서버가 거부한다', async () => {
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    process.env.DELIB_EXTERNAL_LLM_URL = 'https://example.invalid/v1';
    process.env.DELIB_EXTERNAL_LLM_API_KEY = 'test-key-not-used';
    await expect(computeCandidates({ provider: 'external' })).rejects.toThrow(/offsite processing consent/);
    // 거부되었으므로 저장된 후보도 없다.
    expect(await aiObservations.list(adminContext(SID), SID)).toEqual([]);
  });

  it('external provider 는 동의가 있어도 env 미설정이면 거부한다', async () => {
    await confirmConsent({ offsiteProcessing: true });
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    await expect(computeCandidates({ provider: 'external' })).rejects.toThrow(/not configured/);
  });

  it('hidden 발언은 후보에서 제외된다', async () => {
    const round = await bootRound();
    const visible = await newStatement(round, ASSERTIVE_BODY);
    const hidden = await newStatement(round, '다들 무조건 반대하고 있습니다');
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: hidden, action: 'hide', reason: '부적절' }) });

    const computed = await computeCandidates();
    expect(computed.analyzedCount).toBe(1);
    const rows = await aiObservations.list(adminContext(SID), SID);
    expect(rows.map((o) => o.statement_id)).toEqual([visible]);
  });

  it('compute_snapshot 은 검토 후보를 만들지 않는다 (경로 분리, §3)', async () => {
    const round = await bootRound();
    await newStatement(round, ASSERTIVE_BODY);
    await computeSnapshot({ envelope: env('delib.compute_snapshot', 'instructor', { sessionId: SID, roundId: round }) });
    expect(await aiObservations.list(adminContext(SID), SID)).toEqual([]);
  });

  it('참가자는 두 액션 모두 접근 불가 (operator 전용)', () => {
    for (const a of ['delib.compute_ai_observations', 'delib.review_ai_observation']) {
      expect(isAllowed(a, 'participant')).toBe(false);
      for (const role of ['admin', 'instructor', 'assistant'] as const) {
        expect(isAllowed(a, role)).toBe(true);
      }
    }
    // catalog 등록 확인.
    expect(listCatalog()).toContain('delib.compute_ai_observations');
    expect(listCatalog()).toContain('delib.review_ai_observation');
  });

  it('승인된 후보라도 이후 숨김 처리된 발언은 리포트에서 빠진다 (F1 마스킹 원칙)', async () => {
    const round = await bootRound();
    const stId = await newStatement(round, ASSERTIVE_BODY);
    await computeCandidates();
    const pending = await aiObservations.list(adminContext(SID), SID, { status: 'pending' });
    await reviewAiObservation({ envelope: env('delib.review_ai_observation', 'instructor', { observationId: pending[0].id, decision: 'approve' }) });
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: stId, action: 'hide', reason: '부적절' }) });

    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report!.aiObservations).toEqual([]);
    expect(planDelibMarkdownDocument(report!)).not.toContain(ASSERTIVE_BODY);
  });
});

// ============================================================
// fixture/Neon 이원화 방어 — 이 프로젝트에서 3번 반복된 함정.
// 실 DB 없이도 드리프트(컬럼 순서·개수·RLS 역할)를 정적으로 잡는다.
// ============================================================
describe('Q2 검토 후보 — fixture/Neon 이원화 방어', () => {
  const repoSrc = readFileSync(resolve(process.cwd(), 'lib/db/repo/aiObservations.ts'), 'utf8');
  const helpersSrc = readFileSync(resolve(process.cwd(), 'lib/db/neonHelpers.ts'), 'utf8');
  const migration = readFileSync(resolve(process.cwd(), 'db/migrations/0019_ai_observations.sql'), 'utf8');
  const colsList = (helpersSrc.match(/round_ai_observations:\s*\n?\s*'([^']+)'/)?.[1] ?? '')
    .split(',')
    .map((c) => c.trim());

  it('마이그레이션이 kind 를 계획서 범위 2종으로 제한한다', () => {
    expect(migration).toMatch(/create table if not exists round_ai_observations/);
    expect(migration).toMatch(/kind text not null check \(kind in \('evidence_check', 'definition_mismatch'\)\)/);
    expect(migration).toMatch(/status in \('pending', 'approved', 'rejected'\)/);
  });

  it('RLS 는 select/insert/update 전부 operator 이상 — participant 접근 불가', () => {
    expect(migration).toMatch(/alter table round_ai_observations enable row level security/);
    // select: operator 역할 화이트리스트 + 세션 경계.
    expect(migration).toMatch(/for select\s+using \(\s*public\.liveops_role\(\) in \('admin', 'instructor', 'assistant'\)/);
    // insert/update: 세션 쓰기 권한(assistant 이상).
    expect(migration).toMatch(/for insert\s+with check \(public\.liveops_can_write_session\(session_id, 'assistant'\)\)/);
    expect(migration).toMatch(/for update\s+using \(public\.liveops_can_write_session\(session_id, 'assistant'\)\)/);
    // participant 를 허용하는 정책이 섞여 있으면 안 된다.
    expect(migration).not.toMatch(/'participant'/);
  });

  it('COLS.round_ai_observations 가 마이그레이션 컬럼과 일치한다', () => {
    for (const c of [
      'id', 'session_id', 'round_id', 'statement_id', 'kind', 'body',
      'suggested_question', 'status', 'reviewed_by', 'reviewed_at', 'review_reason', 'provider', 'created_at'
    ]) {
      expect(colsList).toContain(c);
      expect(migration).toContain(c);
    }
    expect(colsList).toHaveLength(13);
  });

  it('Neon insert 플레이스홀더 수 = COLS 컬럼 수, 값 순서도 컬럼 순서와 같다', () => {
    const placeholders = repoSrc.match(/insert into round_ai_observations \(\$\{COLS\.round_ai_observations\}\) values \(([^)]+)\)/)?.[1] ?? '';
    expect(placeholders.split(',')).toHaveLength(colsList.length);
    const values = repoSrc.match(/\[row\.id, ([^\]]+)\]/)?.[1] ?? '';
    expect(['row.id', ...values.split(',').map((v) => v.trim())].map((v) => v.replace('row.', ''))).toEqual(colsList);
  });

  it('Neon 경로도 operator ctx 로만 동작한다 (participant 신원 주입 코드 없음)', () => {
    // repo 는 ctx 를 그대로 넘긴다 — participant 로 승격시키는 우회 경로가 없어야 한다.
    expect(repoSrc).not.toMatch(/participantId/);
    expect(repoSrc).not.toMatch(/queryOwner/); // RLS 우회(owner) 사용 금지
  });
});
