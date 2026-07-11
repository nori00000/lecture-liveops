-- Lecture LiveOps — 좌석 신호등 보드 (seat_layouts + seat_marks)
-- Draft migration. Apply only after explicit user approval.
-- 전제: 0002 helper functions (liveops_can_read_session / liveops_can_write_session)
--       + 0004 liveops_anon default privileges (신규 테이블 자동 grant)

create table if not exists seat_layouts (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  name text not null,
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seat_layouts_session_unique unique (session_id)
);

create table if not exists seat_marks (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  seat_key text not null,
  status text not null default 'none',
  reason text not null default '',
  memo text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now(),
  constraint seat_marks_session_seat_unique unique (session_id, seat_key)
);
create index if not exists seat_marks_session_idx on seat_marks(session_id, updated_at desc);

alter table seat_layouts enable row level security;
alter table seat_marks enable row level security;

-- read: 세션 멤버 / write: assistant 이상 (table_statuses와 동일 정책)
drop policy if exists ax_seat_layouts_read on seat_layouts;
create policy ax_seat_layouts_read on seat_layouts for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_seat_layouts_write on seat_layouts;
create policy ax_seat_layouts_write on seat_layouts for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));

drop policy if exists ax_seat_marks_read on seat_marks;
create policy ax_seat_marks_read on seat_marks for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_seat_marks_write on seat_marks;
create policy ax_seat_marks_write on seat_marks for all
  using (public.liveops_can_write_session(session_id, 'assistant'))
  with check (public.liveops_can_write_session(session_id, 'assistant'));
