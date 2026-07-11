-- Lecture LiveOps — RLS policies (15 entity 전체)
-- 실제 push는 사용자 명시 승인 후. 본 파일은 draft.
-- 전제: Supabase Auth + JWT claim `role` ∈ {admin, instructor, assistant, participant}
--       + access_keys 테이블의 hash와 session scope를 검증하는 verify 함수
-- 호출 컨벤션:
--   - request.jwt.claims->>'role'   : 인증된 사용자 role
--   - request.jwt.claims->>'sub'    : auth.uid()
--   - request.headers->>'x-session-id': 현재 세션 (RLS 입력)
--   - request.headers->>'x-access-key': 참가자/보조강사가 사용한 raw 키 (hash 비교)

-- ============================================================
-- helper functions
-- ============================================================

create or replace function public.liveops_role() returns text language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', 'participant')
$$;

create or replace function public.liveops_session_id() returns text language sql stable as $$
  select current_setting('request.headers', true)::jsonb ->> 'x-session-id'
$$;

create or replace function public.liveops_can_read_session(target_session text) returns boolean language sql stable as $$
  select case
    when public.liveops_role() in ('admin') then true
    when public.liveops_role() in ('instructor', 'assistant', 'participant') and target_session = public.liveops_session_id() then true
    else false
  end
$$;

create or replace function public.liveops_can_write_session(target_session text, min_role text) returns boolean language sql stable as $$
  select case
    when public.liveops_role() = 'admin' then true
    when min_role = 'instructor' and public.liveops_role() in ('admin', 'instructor') and target_session = public.liveops_session_id() then true
    when min_role = 'assistant' and public.liveops_role() in ('admin', 'instructor', 'assistant') and target_session = public.liveops_session_id() then true
    when min_role = 'participant' and target_session = public.liveops_session_id() then true
    else false
  end
$$;

-- ============================================================
-- companies / courses / sessions — admin write, member read
-- ============================================================

drop policy if exists ax_companies_read on companies;
create policy ax_companies_read on companies for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant') or exists (
    select 1 from sessions s where s.company_id = companies.id and public.liveops_can_read_session(s.id)
  ));
drop policy if exists ax_companies_write on companies;
create policy ax_companies_write on companies for all
  using (public.liveops_role() = 'admin') with check (public.liveops_role() = 'admin');

drop policy if exists ax_courses_read on courses;
create policy ax_courses_read on courses for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant') or exists (
    select 1 from sessions s where s.course_id = courses.id and public.liveops_can_read_session(s.id)
  ));
drop policy if exists ax_courses_write on courses;
create policy ax_courses_write on courses for all
  using (public.liveops_role() in ('admin', 'instructor')) with check (public.liveops_role() in ('admin', 'instructor'));

drop policy if exists ax_sessions_read on sessions;
create policy ax_sessions_read on sessions for select
  using (public.liveops_can_read_session(id));
drop policy if exists ax_sessions_write on sessions;
create policy ax_sessions_write on sessions for all
  using (public.liveops_role() in ('admin', 'instructor')) with check (public.liveops_role() in ('admin', 'instructor'));

-- ============================================================
-- access_keys — admin only (hash 비교는 서버 함수에서만)
-- ============================================================

drop policy if exists ax_access_keys_admin on access_keys;
create policy ax_access_keys_admin on access_keys for all
  using (public.liveops_role() = 'admin') with check (public.liveops_role() = 'admin');

-- ============================================================
-- qna_items — participant insert / instructor update / member read
-- ============================================================

drop policy if exists ax_qna_read on qna_items;
create policy ax_qna_read on qna_items for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_qna_insert on qna_items;
create policy ax_qna_insert on qna_items for insert
  with check (public.liveops_can_write_session(session_id, 'participant'));
drop policy if exists ax_qna_update on qna_items;
create policy ax_qna_update on qna_items for update
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));
drop policy if exists ax_qna_delete on qna_items;
create policy ax_qna_delete on qna_items for delete
  using (public.liveops_role() = 'admin');

-- ============================================================
-- practice_tickets — participant insert / assistant update / member read
-- ============================================================

drop policy if exists ax_practice_read on practice_tickets;
create policy ax_practice_read on practice_tickets for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_practice_insert on practice_tickets;
create policy ax_practice_insert on practice_tickets for insert
  with check (public.liveops_can_write_session(session_id, 'participant'));
drop policy if exists ax_practice_update on practice_tickets;
create policy ax_practice_update on practice_tickets for update
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- ============================================================
-- resources — instructor write, visibility-gated read
-- ============================================================

drop policy if exists ax_resources_read on resources;
create policy ax_resources_read on resources for select
  using (
    public.liveops_can_read_session(session_id) and (
      visibility in ('public', 'session')
      or (visibility = 'private' and public.liveops_role() in ('admin', 'instructor', 'assistant'))
      or (visibility = 'admin_only' and public.liveops_role() = 'admin')
    )
  );
drop policy if exists ax_resources_write on resources;
create policy ax_resources_write on resources for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- ============================================================
-- ops_logs — assistant write, staff read
-- ============================================================

drop policy if exists ax_ops_read on ops_logs;
create policy ax_ops_read on ops_logs for select
  using (public.liveops_can_read_session(session_id) and (
    visibility != 'admin_only' or public.liveops_role() = 'admin'
  ) and public.liveops_role() in ('admin', 'instructor', 'assistant'));
drop policy if exists ax_ops_write on ops_logs;
create policy ax_ops_write on ops_logs for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- ============================================================
-- assistant_signals — assistant write, staff read
-- ============================================================

drop policy if exists ax_signals_read on assistant_signals;
create policy ax_signals_read on assistant_signals for select
  using (public.liveops_can_read_session(session_id) and public.liveops_role() in ('admin', 'instructor', 'assistant'));
drop policy if exists ax_signals_write on assistant_signals;
create policy ax_signals_write on assistant_signals for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- ============================================================
-- table_statuses — assistant write
-- ============================================================

drop policy if exists ax_table_status_read on table_statuses;
create policy ax_table_status_read on table_statuses for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_table_status_write on table_statuses;
create policy ax_table_status_write on table_statuses for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

-- ============================================================
-- excel_templates / excel_cells — member read, participant update_cell
-- ============================================================

drop policy if exists ax_excel_tpl_read on excel_templates;
create policy ax_excel_tpl_read on excel_templates for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_excel_tpl_write on excel_templates;
create policy ax_excel_tpl_write on excel_templates for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

drop policy if exists ax_excel_cells_read on excel_cells;
create policy ax_excel_cells_read on excel_cells for select
  using (exists (
    select 1 from excel_templates t where t.id = excel_cells.template_id and public.liveops_can_read_session(t.session_id)
  ));
drop policy if exists ax_excel_cells_write on excel_cells;
create policy ax_excel_cells_write on excel_cells for all
  using (exists (
    select 1 from excel_templates t where t.id = excel_cells.template_id and public.liveops_can_write_session(t.session_id, 'participant')
  ))
  with check (exists (
    select 1 from excel_templates t where t.id = excel_cells.template_id and public.liveops_can_write_session(t.session_id, 'participant')
  ));

-- ============================================================
-- export_jobs / external_archives — instructor write
-- ============================================================

drop policy if exists ax_export_read on export_jobs;
create policy ax_export_read on export_jobs for select
  using (public.liveops_can_read_session(session_id) and public.liveops_role() in ('admin', 'instructor'));
drop policy if exists ax_export_write on export_jobs;
create policy ax_export_write on export_jobs for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

drop policy if exists ax_external archive_read on external_archives;
create policy ax_external archive_read on external_archives for select
  using (public.liveops_can_read_session(session_id) and public.liveops_role() in ('admin', 'instructor'));
drop policy if exists ax_external archive_write on external_archives;
create policy ax_external archive_write on external_archives for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- ============================================================
-- action_ledger — write open (서버 함수로만), read staff
-- ============================================================

drop policy if exists ax_ledger_read on action_ledger;
create policy ax_ledger_read on action_ledger for select
  using (public.liveops_role() in ('admin', 'instructor'));
drop policy if exists ax_ledger_insert on action_ledger;
create policy ax_ledger_insert on action_ledger for insert
  with check (true);

-- 끝.
