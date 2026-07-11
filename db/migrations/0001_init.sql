-- Lecture LiveOps — initial schema + RLS draft
-- 실제 push는 사용자 승인 후 별도 진행. 본 파일은 draft.
-- 13 entity + action_ledger 모두 RLS ON.

create extension if not exists "pgcrypto";

-- ============================================================
-- core tables
-- ============================================================

create table if not exists companies (
  id text primary key,
  name text not null,
  slug text not null unique,
  visibility text not null default 'private',
  retention_policy text not null default '30d',
  created_at timestamptz not null default now()
);

create table if not exists courses (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  title text not null,
  description text default '',
  default_venue text default '',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  company_id text not null references companies(id) on delete cascade,
  course_id text not null references courses(id) on delete cascade,
  date date not null,
  title text not null,
  venue text default '',
  mode text not null default 'prep',
  private_by_default boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists access_keys (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  role text not null,
  key_hash text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  scope jsonb not null default '{}'::jsonb
);
create index if not exists access_keys_session_idx on access_keys(session_id);

create table if not exists qna_items (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  body text not null,
  body_redacted text default '',
  answer text,
  status text not null default 'new',
  priority text not null default 'normal',
  tags text[] not null default '{}',
  visibility text not null default 'session',
  created_by_role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qna_session_idx on qna_items(session_id);

create table if not exists practice_tickets (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  table_label text default '',
  body text not null,
  status text not null default 'help_needed',
  severity text not null default 'normal',
  assigned_assistant_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists resources (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  type text not null,
  title text not null,
  url_or_storage_path text not null,
  visibility text not null default 'session',
  stage_tags text[] not null default '{}',
  audience_tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists ops_logs (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  type text not null,
  body text not null,
  visibility text not null default 'private',
  created_by_role text not null,
  created_at timestamptz not null default now()
);

create table if not exists assistant_signals (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  signal_type text not null,
  table_label text default '',
  note text default '',
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists table_statuses (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  table_label text not null,
  progress text not null default 'not_started',
  blocker text default '',
  assistant_id text,
  updated_at timestamptz not null default now()
);

create table if not exists excel_templates (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  title text not null,
  version int not null default 1,
  source_resource_id text,
  schema_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists excel_cells (
  id text primary key,
  template_id text not null references excel_templates(id) on delete cascade,
  sheet_name text not null default 'Sheet1',
  cell_ref text not null,
  value text default '',
  formula text default '',
  updated_by text default '',
  updated_at timestamptz not null default now(),
  unique (template_id, sheet_name, cell_ref)
);

create table if not exists export_jobs (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  profile text not null,
  formats text[] not null default '{}',
  status text not null default 'queued',
  output_paths jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists external_archives (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  target_path text not null,
  status text not null default 'planned',
  frontmatter jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists action_ledger (
  id text primary key,
  session_id text,
  actor_type text not null,
  actor_role text not null,
  tool text not null default 'web-ui',
  action_name text not null,
  input_hash text not null,
  input_redacted_summary text not null,
  output_summary text default '',
  status text not null,
  created_at timestamptz not null default now()
);
create index if not exists action_ledger_session_idx on action_ledger(session_id);
create unique index if not exists action_ledger_idem_idx on action_ledger((input_hash || ':' || action_name));

-- ============================================================
-- RLS — 모든 테이블 default deny + role-based allow
-- 운영 환경에서는 supabase.auth.jwt() ->> 'role' 기반 정책으로 확장
-- ============================================================

alter table companies enable row level security;
alter table courses enable row level security;
alter table sessions enable row level security;
alter table access_keys enable row level security;
alter table qna_items enable row level security;
alter table practice_tickets enable row level security;
alter table resources enable row level security;
alter table ops_logs enable row level security;
alter table assistant_signals enable row level security;
alter table table_statuses enable row level security;
alter table excel_templates enable row level security;
alter table excel_cells enable row level security;
alter table export_jobs enable row level security;
alter table external_archives enable row level security;
alter table action_ledger enable row level security;

-- RLS 정책은 0002_rls_policies.sql 에서 일괄 정의한다.
-- (PostgreSQL은 CREATE POLICY IF NOT EXISTS 미지원 — DROP POLICY IF EXISTS … ; CREATE POLICY … 패턴 사용)
