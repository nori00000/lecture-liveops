-- Lecture LiveOps — P2-1 NextAuth v5 + Neon adapter tables
-- @auth/neon-adapter 가 요구하는 next_auth 스키마 4 테이블 + role 컬럼 추가.

create schema if not exists next_auth;

grant usage on schema next_auth to liveops_anon;

create table if not exists next_auth.users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique,
  "emailVerified" timestamptz,
  image text,
  role text not null default 'instructor' check (role in ('admin', 'instructor', 'assistant')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists next_auth.accounts (
  id uuid primary key default gen_random_uuid(),
  "userId" uuid not null references next_auth.users(id) on delete cascade,
  type text not null,
  provider text not null,
  "providerAccountId" text not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  unique (provider, "providerAccountId")
);

create table if not exists next_auth.sessions (
  id uuid primary key default gen_random_uuid(),
  "sessionToken" text not null unique,
  "userId" uuid not null references next_auth.users(id) on delete cascade,
  expires timestamptz not null
);

create table if not exists next_auth.verification_tokens (
  identifier text not null,
  token text not null,
  expires timestamptz not null,
  primary key (identifier, token)
);

grant select on all tables in schema next_auth to liveops_anon;
alter default privileges in schema next_auth grant select on tables to liveops_anon;
