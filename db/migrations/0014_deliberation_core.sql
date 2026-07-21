-- Lecture LiveOps — 1단계 숙의 도메인 코어 (deliberation core)
-- PRODUCT-PLAN-v2 §3: participants·groups·memberships·rounds·statements·votes·snapshots·moderation
-- Draft migration. Apply only after explicit user approval.
-- 전제: 0002 helper functions (liveops_role / liveops_session_id / liveops_can_read_session / liveops_can_write_session)
--       + 0004 liveops_anon default privileges (신규 테이블/함수 자동 grant)
-- 상태값은 전부 check constraint. 정책명에 공백 금지 (0002/0004 컨벤션 준수).

-- ============================================================
-- participants — 세션 참가자 (익명/기명). access_key로 입장한 1인 = 1 row.
-- ============================================================
create table if not exists participants (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  display_alias text not null default '',
  anon_handle text not null default '',
  access_key_id text references access_keys(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists participants_session_idx on participants(session_id, created_at desc);

-- ============================================================
-- workshop_groups — 분임(breakout) 그룹
-- ============================================================
create table if not exists workshop_groups (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  label text not null,
  topic text not null default ''
);
create index if not exists workshop_groups_session_idx on workshop_groups(session_id);

-- ============================================================
-- group_memberships — participant ↔ group (unique 로 중복 배정 차단)
-- ============================================================
create table if not exists group_memberships (
  id text primary key,
  participant_id text not null references participants(id) on delete cascade,
  group_id text not null references workshop_groups(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint group_memberships_participant_group_unique unique (participant_id, group_id)
);
create index if not exists group_memberships_group_idx on group_memberships(group_id);

-- ============================================================
-- workshop_rounds — 라운드 (plenary 전체 / breakout 분임)
-- unique(session_id, round_index)
-- ============================================================
create table if not exists workshop_rounds (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  round_index int not null,
  title text not null default '',
  mode text not null default 'plenary' check (mode in ('plenary', 'breakout')),
  status text not null default 'pending' check (status in ('pending', 'active', 'closed')),
  created_at timestamptz not null default now(),
  constraint workshop_rounds_session_index_unique unique (session_id, round_index)
);

-- ============================================================
-- statements — 참가자 의견 발언
-- ============================================================
create table if not exists statements (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  round_id text references workshop_rounds(id) on delete set null,
  group_id text references workshop_groups(id) on delete set null,
  author_participant_id text references participants(id) on delete set null,
  body text not null,
  visibility text not null default 'group' check (visibility in ('public', 'group', 'private')),
  moderation_state text not null default 'visible' check (moderation_state in ('visible', 'flagged', 'hidden')),
  created_at timestamptz not null default now()
);
create index if not exists statements_session_idx on statements(session_id, created_at desc);
create index if not exists statements_round_idx on statements(round_id);

-- ============================================================
-- statement_votes — 찬성/반대/유보. unique(statement_id, participant_id) 로 1인 1표 강제.
-- 중복 투표는 upsert 로 변경 허용, unique 제약이 최종 방어선.
-- ============================================================
create table if not exists statement_votes (
  id text primary key,
  statement_id text not null references statements(id) on delete cascade,
  participant_id text not null references participants(id) on delete cascade,
  vote text not null check (vote in ('agree', 'disagree', 'pass')),
  created_at timestamptz not null default now(),
  constraint statement_votes_statement_participant_unique unique (statement_id, participant_id)
);
create index if not exists statement_votes_statement_idx on statement_votes(statement_id);

-- ============================================================
-- landscape_snapshots — 라운드별 집계 지형 스냅샷 (payload 는 집계만, 개인 원자료 없음)
-- published_at: compute 후 publish 로 프로젝터/결과판 공개 시 세팅.
-- ============================================================
create table if not exists landscape_snapshots (
  id text primary key,
  session_id text not null references sessions(id) on delete cascade,
  round_id text references workshop_rounds(id) on delete set null,
  computed_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  published_at timestamptz
);
create index if not exists landscape_snapshots_session_idx on landscape_snapshots(session_id, computed_at desc);

-- ============================================================
-- moderation_events — 신고/숨김/보류 감사 기록
-- ============================================================
create table if not exists moderation_events (
  id text primary key,
  statement_id text not null references statements(id) on delete cascade,
  actor_role text not null check (actor_role in ('admin', 'instructor', 'assistant', 'participant')),
  action text not null check (action in ('flag', 'hide', 'restore', 'approve')),
  reason text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists moderation_events_statement_idx on moderation_events(statement_id, created_at desc);

-- ============================================================
-- 집계 함수 (SECURITY DEFINER) — 거버넌스 §7-2:
--   개인별 투표 원자료는 운영자에게도 미노출. 운영자는 집계·플래그만 접근.
--   statement_votes 의 raw select 는 RLS 로 admin 외 차단하고,
--   집계는 오직 이 definer 함수를 통해서만 노출한다 (개인 표 단위 유출 불가).
-- ============================================================
create or replace function public.delib_vote_tally(p_statement_ids text[])
returns table(statement_id text, agree bigint, disagree bigint, pass bigint)
language sql stable security definer as $$
  select v.statement_id,
    count(*) filter (where v.vote = 'agree'),
    count(*) filter (where v.vote = 'disagree'),
    count(*) filter (where v.vote = 'pass')
  from statement_votes v
  where v.statement_id = any(p_statement_ids)
  group by v.statement_id
$$;

-- ============================================================
-- RLS
-- ============================================================
alter table participants enable row level security;
alter table workshop_groups enable row level security;
alter table group_memberships enable row level security;
alter table workshop_rounds enable row level security;
alter table statements enable row level security;
alter table statement_votes enable row level security;
alter table landscape_snapshots enable row level security;
alter table moderation_events enable row level security;

-- participants — 세션 멤버 read / participant self-register insert / instructor manage
drop policy if exists ax_delib_participants_read on participants;
create policy ax_delib_participants_read on participants for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_delib_participants_insert on participants;
create policy ax_delib_participants_insert on participants for insert
  with check (public.liveops_can_write_session(session_id, 'participant'));
drop policy if exists ax_delib_participants_manage on participants;
create policy ax_delib_participants_manage on participants for update
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- workshop_groups — 세션 멤버 read / instructor write
drop policy if exists ax_delib_groups_read on workshop_groups;
create policy ax_delib_groups_read on workshop_groups for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_delib_groups_write on workshop_groups;
create policy ax_delib_groups_write on workshop_groups for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- group_memberships — participant 의 session 을 통해 scope 판정
drop policy if exists ax_delib_memberships_read on group_memberships;
create policy ax_delib_memberships_read on group_memberships for select
  using (exists (
    select 1 from participants p where p.id = group_memberships.participant_id and public.liveops_can_read_session(p.session_id)
  ));
drop policy if exists ax_delib_memberships_write on group_memberships;
create policy ax_delib_memberships_write on group_memberships for all
  using (exists (
    select 1 from participants p where p.id = group_memberships.participant_id and public.liveops_can_write_session(p.session_id, 'instructor')
  ))
  with check (exists (
    select 1 from participants p where p.id = group_memberships.participant_id and public.liveops_can_write_session(p.session_id, 'instructor')
  ));

-- workshop_rounds — 세션 멤버 read / instructor write
drop policy if exists ax_delib_rounds_read on workshop_rounds;
create policy ax_delib_rounds_read on workshop_rounds for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_delib_rounds_write on workshop_rounds;
create policy ax_delib_rounds_write on workshop_rounds for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- statements — 세션 멤버 read / participant insert / instructor moderate(update)
drop policy if exists ax_delib_statements_read on statements;
create policy ax_delib_statements_read on statements for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_delib_statements_insert on statements;
create policy ax_delib_statements_insert on statements for insert
  with check (public.liveops_can_write_session(session_id, 'participant'));
drop policy if exists ax_delib_statements_moderate on statements;
create policy ax_delib_statements_moderate on statements for update
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- statement_votes — participant insert/update (본인 표 변경).
-- select 는 admin 외 전면 차단: 개인 표 원자료는 운영자에게도 미노출 (거버넌스 §7-2).
-- 집계는 public.delib_vote_tally (security definer) 로만 노출한다.
drop policy if exists ax_delib_votes_insert on statement_votes;
create policy ax_delib_votes_insert on statement_votes for insert
  with check (exists (
    select 1 from statements s where s.id = statement_votes.statement_id and public.liveops_can_write_session(s.session_id, 'participant')
  ));
drop policy if exists ax_delib_votes_update on statement_votes;
create policy ax_delib_votes_update on statement_votes for update
  using (exists (
    select 1 from statements s where s.id = statement_votes.statement_id and public.liveops_can_write_session(s.session_id, 'participant')
  ))
  with check (exists (
    select 1 from statements s where s.id = statement_votes.statement_id and public.liveops_can_write_session(s.session_id, 'participant')
  ));
drop policy if exists ax_delib_votes_admin_read on statement_votes;
create policy ax_delib_votes_admin_read on statement_votes for select
  using (public.liveops_role() = 'admin');

-- landscape_snapshots — 세션 멤버 read / instructor write
drop policy if exists ax_delib_snapshots_read on landscape_snapshots;
create policy ax_delib_snapshots_read on landscape_snapshots for select
  using (public.liveops_can_read_session(session_id));
drop policy if exists ax_delib_snapshots_write on landscape_snapshots;
create policy ax_delib_snapshots_write on landscape_snapshots for all
  using (public.liveops_can_write_session(session_id, 'instructor'))
  with check (public.liveops_can_write_session(session_id, 'instructor'));

-- moderation_events — 운영진 read / statement 의 session 을 통해 instructor insert
drop policy if exists ax_delib_moderation_read on moderation_events;
create policy ax_delib_moderation_read on moderation_events for select
  using (public.liveops_role() in ('admin', 'instructor', 'assistant'));
drop policy if exists ax_delib_moderation_insert on moderation_events;
create policy ax_delib_moderation_insert on moderation_events for insert
  with check (exists (
    select 1 from statements s where s.id = moderation_events.statement_id and public.liveops_can_write_session(s.session_id, 'instructor')
  ));

-- 끝.
