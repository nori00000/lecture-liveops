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
