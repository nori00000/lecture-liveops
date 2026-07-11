-- Lecture LiveOps — P1-1: anon role for RLS enforcement
-- owner role(현 DATABASE_URL)이 RLS를 bypass하던 결함을 제거한다.
-- 일반 요청은 liveops_anon으로 접속하여 helper functions에 의한 RLS 평가를 강제한다.
-- helper functions는 SECURITY DEFINER로 owner 권한 유지 (request.jwt.claims 읽기 보장).
--
-- 적용:
--   psql "$DATABASE_URL" -f db/migrations/0004_anon_role.sql
--   # 이후 liveops_anon role의 password를 Neon Console 또는 neonctl 로 발급한다.
--   alter role liveops_anon with login password '<발급 password>';
--
-- 사용자 명시 승인 (P1-1) 후 즉시 적용 가능.

-- 1) role 생성 (이미 존재하면 skip)
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'liveops_anon') then
    create role liveops_anon nologin;
  end if;
end $$;

-- 2) schema/table/function 권한
grant usage on schema public to liveops_anon;
grant select, insert, update, delete on all tables in schema public to liveops_anon;
grant usage, select on all sequences in schema public to liveops_anon;
grant execute on all functions in schema public to liveops_anon;

-- 3) 신규 객체에도 자동 권한 부여
alter default privileges in schema public grant select, insert, update, delete on tables to liveops_anon;
alter default privileges in schema public grant usage, select on sequences to liveops_anon;
alter default privileges in schema public grant execute on functions to liveops_anon;

-- 4) helper functions는 SECURITY DEFINER 로 owner 권한 유지
-- (current_setting('request.jwt.claims', true) 평가 시 일관성 보장)
alter function public.liveops_role() security definer;
alter function public.liveops_session_id() security definer;
alter function public.liveops_can_read_session(text) security definer;
alter function public.liveops_can_write_session(text, text) security definer;

-- 5) (optional) action_ledger 전용 — anon이 자기 row insert만 가능, 외부 select 금지는 RLS 정책으로 처리됨
-- (0002에서 이미 ax_ledger_insert policy + ax_ledger_read policy 정의됨)
