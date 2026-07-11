-- Lecture LiveOps — P2-2 notify_settings table
create table if not exists notify_settings (
  id uuid primary key default gen_random_uuid(),
  session_id text references sessions(id) on delete cascade,
  event_type text not null check (event_type in ('access_key_issued','qna_answered','signal_raised','export_completed','practice_ticket_critical')),
  channel text not null check (channel in ('email','sms')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, event_type, channel)
);
alter table notify_settings enable row level security;
create policy notify_settings_read on notify_settings for select using (
  coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role' in ('admin','instructor')
);
create policy notify_settings_write on notify_settings for all using (
  coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role' in ('admin','instructor')
) with check (
  coalesce(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role' in ('admin','instructor')
);
grant select, insert, update, delete on notify_settings to liveops_anon;
