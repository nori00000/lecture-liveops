/**
 * 녹음·전사 동의 게이트 회귀 테스트 (fixture mode).
 * 근거: docs/transcript-architecture.md §4, PRODUCT-PLAN-v2 §7-8.
 *  - recordingConsent 미동의 세션은 전사 수집 경로가 열리지 않는다(enforceRecordingConsent 거부)
 *  - 설정 저장·조회 왕복(recordingConsent / recordingConsentAt / offsiteProcessing)
 *  - 모순 상태 거부(사전합의 없이 녹음동의 / 녹음동의 없이 오프사이트 처리)
 *  - "녹음 중" 배너 표시 조건(readRecordingConsent)
 *  - 0017 마이그레이션 SQL 구조 — 오디오 경로 컬럼 부재를 스키마로 강제
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import {
  updateWorkshopSettings,
  enforceRecordingConsent,
  readRecordingConsent
} from '@/lib/action/handlers/delib';
import { sessions } from '@/lib/db/repo';
import { adminContext } from '@/lib/db/neonHelpers';
import { resetStore } from '@/lib/db/fixture/store';
import type { AxActionEnvelope } from '@/lib/action/envelope';

const SID = 'se-001-DEMO';

function env(action: string, input: unknown, sessionId = SID): AxActionEnvelope {
  return {
    action,
    actor: { type: 'human', role: 'instructor', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'rec-' + Math.random().toString(36).slice(2, 8),
    redactionPolicy: 'summary',
    dryRun: false,
    input
  };
}

type SettingsPatch = {
  consentConfirmed?: boolean;
  recordingConsent?: boolean;
  offsiteProcessing?: boolean;
};

async function saveSettings(patch: SettingsPatch = {}) {
  return updateWorkshopSettings({
    envelope: env('delib.update_workshop_settings', {
      sessionId: SID,
      anonymousMode: false,
      disclosure: 'participants',
      retentionDays: 30,
      minorSession: false,
      consentConfirmed: patch.consentConfirmed ?? true,
      minorConsent: false,
      recordingConsent: patch.recordingConsent ?? false,
      offsiteProcessing: patch.offsiteProcessing ?? false
    })
  });
}

function privacyOf(r: Awaited<ReturnType<typeof saveSettings>>) {
  return (r.data as { privacySettings: {
    recordingConsent: boolean; recordingConsentAt: string | null; offsiteProcessing: boolean;
  } }).privacySettings;
}

describe('녹음·전사 동의 — 서버 게이트', () => {
  beforeEach(() => resetStore());

  it('설정 자체가 없는 세션은 전사 수집 거부', async () => {
    await expect(enforceRecordingConsent(adminContext(SID), SID)).rejects.toThrow(/consent not confirmed/);
  });

  it('사전합의만 있고 녹음 동의가 없으면 전사 수집 거부', async () => {
    await saveSettings({ recordingConsent: false });
    await expect(enforceRecordingConsent(adminContext(SID), SID)).rejects.toThrow(/recording consent not confirmed/);
  });

  it('녹음 동의 확정 후 전사 수집 통과', async () => {
    await saveSettings({ recordingConsent: true });
    await expect(enforceRecordingConsent(adminContext(SID), SID)).resolves.toBeUndefined();
  });

  it('없는 세션이면 거부', async () => {
    await expect(enforceRecordingConsent(adminContext('se-nope'), 'se-nope')).rejects.toThrow(/session not found/);
  });
});

describe('녹음·전사 동의 — 설정 저장/조회 왕복', () => {
  beforeEach(() => resetStore());

  it('recordingConsent 저장 시 동의 시각이 함께 기록된다', async () => {
    const ps = privacyOf(await saveSettings({ recordingConsent: true }));
    expect(ps.recordingConsent).toBe(true);
    expect(ps.recordingConsentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(ps.offsiteProcessing).toBe(false);
  });

  it('세션 metadata 로 영속되어 다시 읽힌다', async () => {
    await saveSettings({ recordingConsent: true });
    const session = await sessions.findById(adminContext(SID), SID);
    const rc = readRecordingConsent(session?.metadata);
    expect(rc.active).toBe(true);
    expect(rc.consentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('재저장해도 최초 동의 시각을 보존한다', async () => {
    const first = privacyOf(await saveSettings({ recordingConsent: true }));
    const second = privacyOf(await saveSettings({ recordingConsent: true }));
    expect(second.recordingConsentAt).toBe(first.recordingConsentAt);
  });

  it('동의 해제 시 동의 시각이 지워진다', async () => {
    await saveSettings({ recordingConsent: true });
    const off = privacyOf(await saveSettings({ recordingConsent: false }));
    expect(off.recordingConsent).toBe(false);
    expect(off.recordingConsentAt).toBeNull();
    await expect(enforceRecordingConsent(adminContext(SID), SID)).rejects.toThrow(/recording consent not confirmed/);
  });

  it('기존 호출자(녹음 필드 미전달)는 녹음 동의 없음으로 저장된다 — 회귀 방지', async () => {
    const r = await updateWorkshopSettings({
      envelope: env('delib.update_workshop_settings', {
        sessionId: SID,
        anonymousMode: false,
        disclosure: 'participants',
        retentionDays: 30,
        minorSession: false,
        consentConfirmed: true
      })
    });
    const ps = privacyOf(r);
    expect(ps.recordingConsent).toBe(false);
    expect(ps.recordingConsentAt).toBeNull();
    expect(ps.offsiteProcessing).toBe(false);
  });
});

describe('녹음·전사 동의 — 모순 상태 거부', () => {
  beforeEach(() => resetStore());

  it('사전합의 없이 녹음 동의만 켜는 것은 거부', async () => {
    await expect(saveSettings({ consentConfirmed: false, recordingConsent: true }))
      .rejects.toThrow(/recording consent requires privacy consent/);
  });

  it('녹음 동의 없이 오프사이트 처리 허용은 거부', async () => {
    await expect(saveSettings({ recordingConsent: false, offsiteProcessing: true }))
      .rejects.toThrow(/offsite processing requires recording consent/);
  });
});

describe('녹음·전사 — "녹음 중" 배너 표시 조건', () => {
  it('설정 없음 → 배너 미표시 (fail-closed)', () => {
    expect(readRecordingConsent(undefined).active).toBe(false);
    expect(readRecordingConsent({}).active).toBe(false);
  });

  it('recordingConsent=false → 배너 미표시', () => {
    expect(readRecordingConsent({ privacy_settings: { recordingConsent: false } }).active).toBe(false);
  });

  it('recordingConsent=true → 배너 표시 + 동의 시각 노출', () => {
    const rc = readRecordingConsent({
      privacy_settings: { recordingConsent: true, recordingConsentAt: '2026-07-22T00:00:00.000Z' }
    });
    expect(rc.active).toBe(true);
    expect(rc.consentAt).toBe('2026-07-22T00:00:00.000Z');
  });

  it('동의 시각이 손상된 값이면 null 로 축소한다 (배너는 표시)', () => {
    const rc = readRecordingConsent({ privacy_settings: { recordingConsent: true, recordingConsentAt: 123 } });
    expect(rc.active).toBe(true);
    expect(rc.consentAt).toBeNull();
  });
});

describe('0017 전사 마이그레이션 — 스키마 구조', () => {
  const sql = readFileSync(
    path.join(process.cwd(), 'db', 'migrations', '0017_transcript_consent.sql'),
    'utf8'
  );

  it('전사 테이블 3종을 생성한다', () => {
    for (const t of ['transcript_sources', 'transcript_segments', 'transcript_insights']) {
      expect(sql).toContain(`create table if not exists ${t} (`);
      expect(sql).toContain(`alter table ${t} enable row level security;`);
    }
  });

  it('오디오 경로·파일명 컬럼을 만들지 않는다 (원음성 미반출을 스키마로 강제)', () => {
    expect(sql).not.toMatch(/\b(audio_path|audio_url|audio_uri|file_path|file_name|filename|wav|recording_url)\b/i);
  });

  it('select 는 operator 이상만 — 참가자 열람 차단', () => {
    const reads = sql.match(/create policy ax_transcript_\w+_read[\s\S]*?;/g) ?? [];
    expect(reads.length).toBe(3);
    for (const p of reads) expect(p).toContain("public.liveops_role() in ('admin', 'instructor', 'assistant')");
  });

  it('쓰기 정책은 instructor 이상 서버 경로만', () => {
    const writes = sql.match(/create policy ax_transcript_\w+_write[\s\S]*?;/g) ?? [];
    expect(writes.length).toBe(3);
    for (const p of writes) expect(p).toContain("'instructor'");
  });

  it('멱등 재전송 방어 unique 제약이 있다', () => {
    expect(sql).toContain('unique (source_id, started_ms)');
  });

  it('SQL 문법 — 모든 정책 재생성 앞에 drop policy if exists 가 선행하고 괄호가 균형을 이룬다', () => {
    const creates = sql.match(/create policy /g)?.length ?? 0;
    const drops = sql.match(/drop policy if exists /g)?.length ?? 0;
    expect(creates).toBe(drops);
    expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length);
    // 주석·빈 줄을 제외한 마지막 실행문은 세미콜론으로 끝난다.
    const statements = sql
      .split('\n')
      .filter((l) => l.trim() && !l.trim().startsWith('--'))
      .join('\n')
      .trim();
    expect(statements.endsWith(';')).toBe(true);
  });
});
