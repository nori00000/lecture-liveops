-- Lecture LiveOps — 숙의 도메인 보안 하드닝 (deliberation hardening)
-- 이중 적대 리뷰(2026-07-22) CRITICAL/MAJOR 결함 대응. 0014 는 수정 금지 — 정책 교체/제약 추가는 전부 여기.
-- 전제: 0002 helper functions + 0004 liveops_anon + 0014 숙의 코어.
-- 컨벤션: DROP POLICY IF EXISTS 후 재생성. trigger/function 은 SECURITY DEFINER + search_path 고정.

-- ============================================================
-- 신원 helper — participant/group 식별을 RLS 에서 참조 (M-1).
-- route layer 가 request.jwt.claims 에 participant_id/group_id 를 주입한다 (서버 신뢰 경로만).
-- ============================================================
create or replace function public.liveops_participant_id() returns text language sql stable
  security definer set search_path = public, pg_temp as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'participant_id'
$$;

create or replace function public.liveops_group_id() returns text language sql stable
  security definer set search_path = public, pg_temp as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'group_id'
$$;

-- ============================================================
-- C-C: delib_vote_tally 세션 필터. SECURITY DEFINER 가 세션 경계 없이 집계를 노출하던 결함 봉합.
--   statements join + can_read_session 으로 현재 세션이 읽을 수 있는 발언만 집계.
--   search_path 고정 + PUBLIC execute 회수(액세스는 liveops_anon 만).
-- ============================================================
create or replace function public.delib_vote_tally(p_statement_ids text[])
returns table(statement_id text, agree bigint, disagree bigint, pass bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.statement_id,
    count(*) filter (where v.vote = 'agree'),
    count(*) filter (where v.vote = 'disagree'),
    count(*) filter (where v.vote = 'pass')
  from statement_votes v
  join statements s on s.id = v.statement_id
  where v.statement_id = any(p_statement_ids)
    and public.liveops_can_read_session(s.session_id)
  group by v.statement_id
$$;
revoke all on function public.delib_vote_tally(text[]) from public;
grant execute on function public.delib_vote_tally(text[]) to liveops_anon;

-- ============================================================
-- M-3: group_memberships 1인 1그룹 강제 (participant_id unique).
--   0014 의 unique(participant_id, group_id) 로는 한 참가자가 여러 그룹에 배정 가능 → 봉합.
-- ============================================================
alter table group_memberships drop constraint if exists group_memberships_participant_unique;
alter table group_memberships add constraint group_memberships_participant_unique unique (participant_id);

-- ============================================================
-- C-B: participants — access_key 당 1 participant (ballot stuffing 방지).
--   /p/enter 는 access_key_id 로 조회 재사용, 없으면 1개 생성.
-- ============================================================
create unique index if not exists participants_access_key_unique
  on participants(access_key_id) where access_key_id is not null;

-- ============================================================
-- M-4: 세션당 active 라운드 단일성. partial unique index.
-- ============================================================
create unique index if not exists workshop_rounds_active_unique
  on workshop_rounds(session_id) where status = 'active';

-- ============================================================
-- C-E: statements 세션 경계 + closed round 제출 차단 trigger.
--   round/group/author 가 statement 의 session_id 와 다르면 거부.
--   INSERT 시 대상 라운드가 closed 면 거부.
-- ============================================================
create or replace function public.delib_statement_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r_status text;
  r_session text;
  g_session text;
  a_session text;
begin
  if new.round_id is not null then
    select status, session_id into r_status, r_session from workshop_rounds where id = new.round_id;
    if r_session is not null and r_session <> new.session_id then
      raise exception 'delib: statement round session mismatch';
    end if;
    if tg_op = 'INSERT' and r_status = 'closed' then
      raise exception 'delib: cannot submit to a closed round';
    end if;
  end if;
  if new.group_id is not null then
    select session_id into g_session from workshop_groups where id = new.group_id;
    if g_session is not null and g_session <> new.session_id then
      raise exception 'delib: statement group session mismatch';
    end if;
  end if;
  if new.author_participant_id is not null then
    select session_id into a_session from participants where id = new.author_participant_id;
    if a_session is not null and a_session <> new.session_id then
      raise exception 'delib: statement author session mismatch';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists delib_statement_guard_trg on statements;
create trigger delib_statement_guard_trg before insert or update on statements
  for each row execute function public.delib_statement_guard();

-- ============================================================
-- M-3: group_memberships 세션 경계 trigger (participant/group 동일 세션).
-- ============================================================
create or replace function public.delib_membership_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p_session text;
  g_session text;
begin
  select session_id into p_session from participants where id = new.participant_id;
  select session_id into g_session from workshop_groups where id = new.group_id;
  if p_session is null or g_session is null or p_session <> g_session then
    raise exception 'delib: membership session mismatch';
  end if;
  return new;
end $$;
drop trigger if exists delib_membership_guard_trg on group_memberships;
create trigger delib_membership_guard_trg before insert or update on group_memberships
  for each row execute function public.delib_membership_guard();

-- ============================================================
-- C-A/C-B: statement_votes 세션 경계 trigger (표를 던지는 participant 와 발언이 동일 세션).
--   RLS 는 세션 헤더 기준으로 이미 막지만, participant/statement 세션 불일치를 DB 레벨에서 재확인.
-- ============================================================
create or replace function public.delib_vote_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p_session text;
  s_session text;
begin
  select session_id into p_session from participants where id = new.participant_id;
  select session_id into s_session from statements where id = new.statement_id;
  if p_session is null or s_session is null or p_session <> s_session then
    raise exception 'delib: vote session mismatch';
  end if;
  return new;
end $$;
drop trigger if exists delib_vote_guard_trg on statement_votes;
create trigger delib_vote_guard_trg before insert or update on statement_votes
  for each row execute function public.delib_vote_guard();

-- ============================================================
-- M-1: statements read 정책 재작성 — visibility/moderation 반영.
--   staff(admin/instructor/assistant) 는 세션 내 전체 열람.
--   participant 는 moderation_state='visible' 이면서 (public | 본인 그룹 | 본인 저작) 만.
--   hidden/flagged, private(비저작) 은 participant 미노출.
-- ============================================================
drop policy if exists ax_delib_statements_read on statements;
create policy ax_delib_statements_read on statements for select
  using (
    public.liveops_can_read_session(session_id) and (
      public.liveops_role() in ('admin', 'instructor', 'assistant')
      or (
        moderation_state = 'visible' and (
          visibility = 'public'
          or author_participant_id = public.liveops_participant_id()
          or (visibility = 'group' and (group_id is null or group_id = public.liveops_group_id()))
        )
      )
    )
  );

-- ============================================================
-- M-7: assistant = 운영자. 숙의 write 정책의 min_role 을 instructor → assistant 로 낮춰
--   permission matrix(assistant 허용) 와 일치시킨다.
-- ============================================================
drop policy if exists ax_delib_participants_manage on participants;
create policy ax_delib_participants_manage on participants for update
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_delib_groups_write on workshop_groups;
create policy ax_delib_groups_write on workshop_groups for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_delib_memberships_write on group_memberships;
create policy ax_delib_memberships_write on group_memberships for all
  using (exists (
    select 1 from participants p where p.id = group_memberships.participant_id and public.liveops_can_write_session(p.session_id, 'assistant')
  ))
  with check (exists (
    select 1 from participants p where p.id = group_memberships.participant_id and public.liveops_can_write_session(p.session_id, 'assistant')
  ));

drop policy if exists ax_delib_rounds_write on workshop_rounds;
create policy ax_delib_rounds_write on workshop_rounds for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_delib_statements_moderate on statements;
create policy ax_delib_statements_moderate on statements for update
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_delib_snapshots_write on landscape_snapshots;
create policy ax_delib_snapshots_write on landscape_snapshots for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- ============================================================
-- M-2: moderation_events read 세션 제한.
--   0014 는 role 만 확인(타 세션 audit 유출). statement join + can_read_session 추가.
--   insert 도 assistant 허용으로 하향(M-7).
-- ============================================================
drop policy if exists ax_delib_moderation_read on moderation_events;
create policy ax_delib_moderation_read on moderation_events for select
  using (
    public.liveops_role() in ('admin', 'instructor', 'assistant')
    and exists (
      select 1 from statements s where s.id = moderation_events.statement_id and public.liveops_can_read_session(s.session_id)
    )
  );

drop policy if exists ax_delib_moderation_insert on moderation_events;
create policy ax_delib_moderation_insert on moderation_events for insert
  with check (exists (
    select 1 from statements s where s.id = moderation_events.statement_id and public.liveops_can_write_session(s.session_id, 'assistant')
  ));

-- 끝.
