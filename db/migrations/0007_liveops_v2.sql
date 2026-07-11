-- Lecture LiveOps v2 — AI Lecture Cockpit extension
-- Draft migration. Apply only after explicit user approval.

create table if not exists live_observations (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  raw_note_id text,
  category text not null,
  time_label text,
  target text,
  mood text,
  lecture_speed text,
  severity text not null default 'low',
  question text,
  answer text,
  issue text,
  cause text,
  solution text,
  action_required text,
  material_title text,
  visibility text not null default 'session',
  summary text not null,
  confidence numeric not null default 0.7,
  created_at timestamptz not null default now()
);
create index if not exists live_observations_session_idx on live_observations(session_id, created_at desc);

create table if not exists situation_snapshots (
  session_id text primary key references sessions(id) on delete cascade,
  generated_at timestamptz not null default now(),
  current_phase text not null,
  risk_level text not null,
  mood_summary text not null,
  lecture_speed text not null,
  question_load text not null,
  blocker_summary text not null,
  material_summary text not null,
  ai_summary text not null,
  suggested_main_instructor_actions text[] not null default '{}',
  suggested_assistant_actions text[] not null default '{}',
  unresolved_targets text[] not null default '{}'
);

create table if not exists material_versions (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  resource_id text references resources(id) on delete set null,
  title text not null,
  type text not null,
  url_or_storage_path text not null,
  status text not null default 'draft',
  audience text not null default 'all',
  version int not null default 1,
  latest_change_summary text,
  updated_by text,
  updated_at timestamptz not null default now()
);
create index if not exists material_versions_session_idx on material_versions(session_id, updated_at desc);

alter table live_observations enable row level security;
alter table situation_snapshots enable row level security;
alter table material_versions enable row level security;
