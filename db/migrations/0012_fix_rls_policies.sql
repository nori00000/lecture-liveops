-- Fix invalid external_archives policy names introduced in 0002.
-- 0002 is immutable once applied; recreate the policies with valid identifiers here.

drop policy if exists "ax_external archive_read" on external_archives;
drop policy if exists "ax_external archive_write" on external_archives;
drop policy if exists ax_external_archive_read on external_archives;
drop policy if exists ax_external_archive_write on external_archives;

create policy ax_external_archive_read on external_archives for select
  using (public.liveops_can_read_session(session_id) and public.liveops_role() in ('admin', 'instructor'));

create policy ax_external_archive_write on external_archives for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- 0002 can fail before creating action_ledger policies because of the invalid
-- external_archives policy identifiers above. Recreate the intended ledger
-- policies idempotently so partially migrated databases are repaired.
drop policy if exists ax_ledger_read on action_ledger;
create policy ax_ledger_read on action_ledger for select
  using (public.liveops_role() in ('admin', 'instructor'));

drop policy if exists ax_ledger_insert on action_ledger;
create policy ax_ledger_insert on action_ledger for insert
  with check (true);

-- Verification query: should return all expected policy names after 0012.
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('external_archives', 'action_ledger')
  and policyname in (
    'ax_external_archive_read',
    'ax_external_archive_write',
    'ax_ledger_read',
    'ax_ledger_insert'
  )
order by tablename, policyname;
