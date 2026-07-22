-- Lecture LiveOps — 전사(transcript) 스키마 + RLS (동의 기반 테이블 단위 전사 준비)
-- 근거: docs/transcript-architecture.md §2. 이 마이그레이션은 **스키마와 RLS만** 만든다 —
--       ingest API·WhisperLive 연동은 다음 단계이며, 현재 어떤 애플리케이션 코드도 이 테이블을 읽거나 쓰지 않는다.
-- 전제: 0002 helper functions (liveops_role / liveops_can_read_session / liveops_can_write_session)
--       + 0004 liveops_anon default privileges + 0014 숙의 코어(sessions/workshop_groups/workshop_rounds/statements).
-- 컨벤션: 정책명 공백 금지, DROP POLICY IF EXISTS 후 재생성, 상태값은 check constraint.
--
-- 프라이버시 원칙(문서가 아니라 구조로 강제):
--   * 오디오 파일 경로·파일명·URI 컬럼을 **의도적으로 만들지 않는다.** 원음성은 현장 박스를 떠나지 않는다.
--   * speaker_tag 는 화자분리 결과가 아니라 **테이블 라벨**('T3')이다. 개인 화자 식별은 스키마 범위 밖.
--   * 세션 privacy_settings.recordingConsent 게이트는 서버 코드(enforceRecordingConsent)가 담당한다.

-- ============================================================
-- transcript_sources — 분임(테이블) ↔ 녹음기기 매핑. 동의 확인 시각을 함께 기록.
-- ============================================================
create table if not exists transcript_sources (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  group_id text references workshop_groups(id) on delete set null,
  device_label text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  consent_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists transcript_sources_session_idx on transcript_sources(session_id, started_at desc);

-- ============================================================
-- transcript_segments — 전사 텍스트 세그먼트. 오디오 경로 컬럼 없음(의도적).
-- 멱등성: unique(source_id, started_ms) — 현장 박스 재전송이 중복 행을 만들지 않는다.
-- ============================================================
create table if not exists transcript_segments (
  id text primary key,
  source_id text not null references transcript_sources(id) on delete cascade,
  round_id text references workshop_rounds(id) on delete set null,
  speaker_tag text not null default '',
  started_ms int not null,
  ended_ms int not null,
  text text not null,
  confidence real,
  created_at timestamptz not null default now(),
  constraint transcript_segments_source_start_unique unique (source_id, started_ms)
);
create index if not exists transcript_segments_source_idx on transcript_segments(source_id, started_ms);

-- ============================================================
-- transcript_insights — LLM 논거 추출 후보. 승인된 것만 statements 로 승격(사람 승인 게이트).
-- promoted_statement_id 역참조로 UI 가 "AI 정리 초안" 라벨 + 근거 세그먼트를 표시한다(§7-5 AI 라벨).
-- ============================================================
create table if not exists transcript_insights (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  round_id text references workshop_rounds(id) on delete set null,
  group_id text references workshop_groups(id) on delete set null,
  body text not null,
  kind text not null default 'argument' check (kind in ('argument', 'question', 'agreement', 'disagreement', 'other')),
  evidence_segment_ids text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  promoted_statement_id text references statements(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists transcript_insights_session_idx on transcript_insights(session_id, created_at desc);

-- ============================================================
-- RLS — select 는 operator(admin/instructor/assistant) 이상만(참가자 열람 금지).
--       insert/update/delete 는 서버 경로(instructor 이상 쓰기 권한)만.
-- ============================================================
alter table transcript_sources enable row level security;
alter table transcript_segments enable row level security;
alter table transcript_insights enable row level security;

-- transcript_sources
drop policy if exists ax_transcript_sources_read on transcript_sources;
create policy ax_transcript_sources_read on transcript_sources for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant') and public.liveops_can_read_session(session_id));
drop policy if exists ax_transcript_sources_write on transcript_sources;
create policy ax_transcript_sources_write on transcript_sources for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- transcript_segments — 세션 경계는 source 를 통해 판정.
drop policy if exists ax_transcript_segments_read on transcript_segments;
create policy ax_transcript_segments_read on transcript_segments for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant') and exists (
    select 1 from transcript_sources s where s.id = transcript_segments.source_id and public.liveops_can_read_session(s.session_id)
  ));
drop policy if exists ax_transcript_segments_write on transcript_segments;
create policy ax_transcript_segments_write on transcript_segments for all
  using (exists (
    select 1 from transcript_sources s where s.id = transcript_segments.source_id and public.liveops_can_write_session(s.session_id, 'instructor')
  ))
  with check (exists (
    select 1 from transcript_sources s where s.id = transcript_segments.source_id and public.liveops_can_write_session(s.session_id, 'instructor')
  ));

-- transcript_insights
drop policy if exists ax_transcript_insights_read on transcript_insights;
create policy ax_transcript_insights_read on transcript_insights for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant') and public.liveops_can_read_session(session_id));
drop policy if exists ax_transcript_insights_write on transcript_insights;
create policy ax_transcript_insights_write on transcript_insights for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- 끝. (ingest 경로·세션 스코프 토큰은 다음 단계에서 추가한다)
