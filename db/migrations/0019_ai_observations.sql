-- Lecture LiveOps — 사후 리포트 "검토가 필요한 주장" 후보 (Q2)
-- 근거: docs/DELIBERATION-QUALITY-PLAN.md §2 Q2 · §3 아키텍처 · §5 지표.
--   세션 종료 후 배치로 후보를 뽑고 **퍼실리테이터가 승인한 것만** 납품 리포트에 싣는다.
--   §1 이 금지한 것은 "참가자에게 실시간 오류 판정 표시"다. 이 테이블은 사후·사람 검토 전제이므로
--   그 반대 근거(오탐 비용·self-level 피드백·청중 앞 노출)가 전부 무력화된다.
--
-- 설계 결정:
--   * moderation_events 와 **분리된 별도 테이블**(§3). 품질 피드백이 제재(moderation)로 보이면 안 된다.
--   * kind 는 계획서 범위인 2종만 check constraint 로 고정 — 범위 확장은 새 마이그레이션으로.
--   * status 는 pending → approved|rejected. 기각은 영구 제외(리포트는 approved 만 읽는다).
--   * review_reason: §5 지표 "Q2 오탐 신고율(기각 사유 기록)" 실측용. 선택 입력(기본 '').
--   * RLS: select/insert/update 전부 operator(admin/instructor/assistant) 이상.
--     **참가자는 어떤 경로로도 읽을 수 없다** — 참가자 화면·프로젝터 노출 금지가 코드가 아니라 DB 로 강제된다.
--   * 0014/0015/0017 등 기존 마이그레이션은 수정하지 않는다 (적용 완료 마이그레이션 불변).
-- 전제: 0002 helper functions(liveops_role / liveops_can_read_session / liveops_can_write_session)
--       + 0004 liveops_anon default privileges + 0014 숙의 코어(sessions/workshop_rounds/statements).

create table if not exists round_ai_observations (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  round_id text references workshop_rounds(id) on delete set null,
  statement_id text not null references statements(id) on delete cascade,
  -- 계획서 §2 Q2 범위 2종. 'evidence_check' 근거 확인 필요 / 'definition_mismatch' 용어 정의 불일치.
  kind text not null check (kind in ('evidence_check', 'definition_mismatch')),
  -- 개인·진영 라벨 금지 톤. "이 발언은 틀렸다"가 아니라 "근거 확인이 필요해 보입니다".
  body text not null,
  -- 퍼실리테이터가 그대로 쓸 수 있는 제안 질문.
  suggested_question text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_reason text not null default '',
  -- 어떤 provider 가 만든 후보인지 (stub|local|external) — 정밀도 실측 시 provider 별 비교에 쓴다.
  provider text not null default 'stub',
  created_at timestamptz not null default now()
);
create index if not exists round_ai_observations_session_idx on round_ai_observations(session_id, created_at desc);
create index if not exists round_ai_observations_statement_idx on round_ai_observations(statement_id);

-- ============================================================
-- RLS — operator 이상 전용. participant 는 select 조차 불가.
-- ============================================================
alter table round_ai_observations enable row level security;

drop policy if exists ax_delib_ai_observations_read on round_ai_observations;
create policy ax_delib_ai_observations_read on round_ai_observations for select
  using (
    public.liveops_role() in ('admin', 'instructor', 'assistant')
    and public.liveops_can_read_session(session_id)
  );

drop policy if exists ax_delib_ai_observations_insert on round_ai_observations;
create policy ax_delib_ai_observations_insert on round_ai_observations for insert
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_delib_ai_observations_update on round_ai_observations;
create policy ax_delib_ai_observations_update on round_ai_observations for update
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- 끝.
