/**
 * 숙의 워크숍 리포트 단위 테스트 (fixture mode).
 * 검증: 개인 투표 원자료 미포함 · k-익명 억제 반영 · 익명모드 alias 마스킹 · traceability(결과→statementId).
 * AX_MODE 강제 fixture (DATABASE_URL 무시).
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
  submitStatement,
  voteStatement,
  moderateStatement
} from '@/lib/action/handlers/delib';
import { buildWorkshopReport } from '@/lib/delib/report';
import { planDelibMarkdownDocument, planDelibHtmlExport, planDelibXlsxBuffer } from '@/lib/delib/reportFormats';
import ExcelJS from 'exceljs';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';
import type { VoteValue } from '@/lib/db/schema';

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

async function confirmConsent(anonymousMode = false): Promise<void> {
  await updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', 'instructor', {
      sessionId: SID, anonymousMode, disclosure: 'operators_only', retentionDays: 30,
      minorSession: false, consentConfirmed: true
    })
  });
}

async function bootRound(title = 'R0'): Promise<string> {
  const r = await createWorkshop({ envelope: env('delib.create_workshop', 'instructor', { sessionId: SID, title }) });
  return (r.data as { roundId: string }).roundId;
}

async function newParticipant(alias: string, anonHandle: string): Promise<string> {
  const r = await registerParticipant({ envelope: env('delib.register_participant', 'instructor', { sessionId: SID, displayAlias: alias, anonHandle }) });
  return (r.data as { participantId: string }).participantId;
}

// operator 대리 발언 (author 없음 → rawData authorAlias='(운영자 대리)')
async function newStatement(roundId: string, body: string): Promise<string> {
  const r = await submitStatement({ envelope: env('delib.submit_statement', 'instructor', { sessionId: SID, roundId, body }) });
  return (r.data as { statementId: string }).statementId;
}

async function vote(statementId: string, participantId: string, v: VoteValue): Promise<void> {
  await voteStatement({ envelope: env('delib.vote_statement', 'participant', { statementId, vote: v }), trusted: { participantId } });
}

describe('delib workshop report (fixture mode)', () => {
  beforeEach(async () => {
    resetStore();
    await confirmConsent(false);
  });

  it('개인 투표 원자료를 리포트에 포함하지 않는다 (집계만)', async () => {
    const round = await bootRound();
    const p1 = await newParticipant('앨리스', 'anon-1');
    const p2 = await newParticipant('밥', 'anon-2');
    const p3 = await newParticipant('캐럴', 'anon-3');
    const st = await newStatement(round, '기후 예산을 늘려야 한다');
    await vote(st, p1, 'agree');
    await vote(st, p2, 'agree');
    await vote(st, p3, 'disagree');

    const report = await buildWorkshopReport(adminContext(SID), SID);
    expect(report).not.toBeNull();
    const raw = report!.rawData.find((r) => r.statementId === st)!;
    // 집계는 존재하지만 개인 표 배열/투표자 신원은 어디에도 없어야 한다.
    expect(raw.agree).toBe(2);
    expect(raw.disagree).toBe(1);
    const serialized = JSON.stringify(report);
    for (const pid of [p1, p2, p3]) {
      expect(serialized).not.toContain(pid); // 투표자 participantId 누출 없음
    }
  });

  it('k-익명 억제를 리포트 원자료에 반영한다 (표본 부족)', async () => {
    const round = await bootRound();
    const p1 = await newParticipant('앨리스', 'anon-1');
    const p2 = await newParticipant('밥', 'anon-2');
    const p3 = await newParticipant('캐럴', 'anon-3');
    const big = await newStatement(round, '충분히 투표된 발언');
    const tiny = await newStatement(round, '소수만 투표한 발언');
    // big: 3표 (억제 안 됨), tiny: 2표 (k=3 미만 → 억제)
    await vote(big, p1, 'agree');
    await vote(big, p2, 'agree');
    await vote(big, p3, 'disagree');
    await vote(tiny, p1, 'agree');
    await vote(tiny, p2, 'disagree');

    const report = await buildWorkshopReport(adminContext(SID), SID);
    const tinyRaw = report!.rawData.find((r) => r.statementId === tiny)!;
    const bigRaw = report!.rawData.find((r) => r.statementId === big)!;
    expect(tinyRaw.suppressed).toBe(true);
    expect(tinyRaw.agree).toBe(0); // 수치 마스킹
    expect(bigRaw.suppressed).toBe(false);
    // 억제된 발언은 라운드 결과 랭킹(consensus)에도 노출되지 않는다.
    const r0 = report!.rounds.find((r) => r.roundId === round)!;
    expect(r0.consensus.map((c) => c.statementId)).not.toContain(tiny);
  });

  it('익명 모드에서 원자료 작성자를 비연결 처리한다 (F4)', async () => {
    await confirmConsent(true); // anonymousMode=true 로 갱신
    const round = await bootRound();
    const author = await newParticipant('실명홍길동', 'anon-gildong');
    // 참가자 본인이 저작한 발언 (author = participant)
    const st = await submitStatement({
      envelope: env('delib.submit_statement', 'participant', { sessionId: SID, roundId: round, body: '익명 저작 발언' }),
      trusted: { participantId: author }
    });
    const stId = (st.data as { statementId: string }).statementId;

    const report = await buildWorkshopReport(adminContext(SID), SID);
    const raw = report!.rawData.find((r) => r.statementId === stId)!;
    expect(report!.procedure.anonymousMode).toBe(true);
    // F4: 작성자 컬럼은 '익명' 고정 — 반복 핸들(anon_handle)/participantId 로 작성자별 발언을 연결할 수 없다.
    expect(raw.authorAlias).toBe('익명');
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('실명홍길동'); // display_alias 미노출
    expect(serialized).not.toContain('anon-gildong'); // anon_handle 비노출 (비연결)
    expect(serialized).not.toContain(author); // participantId 비노출 (비연결)
    // traceability 는 statementId 로 유지.
    expect(raw.statementId).toBe(stId);
  });

  it('숨김(hidden) 발언 body 를 원자료·md/html/xlsx 어디에도 노출하지 않는다 (F1)', async () => {
    const round = await bootRound();
    const p1 = await newParticipant('앨리스', 'anon-1');
    const p2 = await newParticipant('밥', 'anon-2');
    const p3 = await newParticipant('캐럴', 'anon-3');
    const secret = await newStatement(round, '민감한 숨김 대상 발언 XYZ');
    await vote(secret, p1, 'agree');
    await vote(secret, p2, 'disagree');
    await vote(secret, p3, 'pass');
    // 운영자가 숨김 처리.
    await moderateStatement({ envelope: env('delib.moderate_statement', 'instructor', { statementId: secret, action: 'hide', reason: '부적절' }) });

    const report = await buildWorkshopReport(adminContext(SID), SID);
    const raw = report!.rawData.find((r) => r.statementId === secret)!;
    // moderation 사실은 남기되 body 는 마스킹.
    expect(raw.moderationState).toBe('hidden');
    expect(raw.body).toBe('(운영자가 숨김 처리한 발언)');
    // md/html 어디에도 원문이 없다.
    const md = planDelibMarkdownDocument(report!);
    const html = planDelibHtmlExport(report!);
    expect(md).not.toContain('민감한 숨김 대상 발언 XYZ');
    expect(html).not.toContain('민감한 숨김 대상 발언 XYZ');
    expect(md).toContain('(운영자가 숨김 처리한 발언)');
    // xlsx 셀에도 원문이 없다.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await planDelibXlsxBuffer(report!) as unknown as ArrayBuffer);
    let xlsxText = '';
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => { xlsxText += String(c.value ?? '') + '\n'; })));
    expect(xlsxText).not.toContain('민감한 숨김 대상 발언 XYZ');
    expect(xlsxText).toContain('(운영자가 숨김 처리한 발언)');
  });

  it('traceability — 결과 항목이 원 statementId/roundId 에 연결된다', async () => {
    const round = await bootRound('숙의 라운드');
    const p1 = await newParticipant('앨리스', 'anon-1');
    const p2 = await newParticipant('밥', 'anon-2');
    const p3 = await newParticipant('캐럴', 'anon-3');
    const st = await newStatement(round, '만장일치 합의 발언');
    await vote(st, p1, 'agree');
    await vote(st, p2, 'agree');
    await vote(st, p3, 'agree');

    const report = await buildWorkshopReport(adminContext(SID), SID);
    const r0 = report!.rounds.find((r) => r.roundId === round)!;
    expect(r0.consensus.length).toBeGreaterThan(0);
    const top = r0.consensus[0];
    // 결과 → 원 statementId/roundId 로 되짚을 수 있어야 한다.
    expect(top.statementId).toBe(st);
    expect(top.roundId).toBe(round);
    expect(top.body).toBe('만장일치 합의 발언');
    // 원자료 섹션에 동일 statementId 가 존재한다 (결론→원자료 연결).
    expect(report!.rawData.map((r) => r.statementId)).toContain(top.statementId);
  });
});
