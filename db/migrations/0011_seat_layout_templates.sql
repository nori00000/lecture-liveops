-- Lecture LiveOps — 좌석 배치도 템플릿 (seat_layout_templates)
-- Draft migration. Apply only after explicit user approval.
-- 전제: 0002 helper functions (liveops_can_read_session / liveops_can_write_session)

create table if not exists seat_layout_templates (
  id text primary key,
  slug text not null,
  name text not null,
  description text default '',
  layout jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seat_layout_templates_slug_unique unique (slug)
);

alter table seat_layout_templates enable row level security;

-- read: 모든 권한자(authenticated/liveops_anon)가 읽을 수 있도록 허용 (global preset 개념)
drop policy if exists ax_seat_layout_templates_read on seat_layout_templates;
create policy ax_seat_layout_templates_read on seat_layout_templates for select
  using (true);

-- write: 강사(instructor) 및 어드민만 생성/수정 가능
drop policy if exists ax_seat_layout_templates_write on seat_layout_templates;
create policy ax_seat_layout_templates_write on seat_layout_templates for all
  using (public.liveops_can_write_session(null, 'instructor'))
  with check (public.liveops_can_write_session(null, 'instructor'));

-- 초기 시드 데이터 주입 (id prefix: slt-)
insert into seat_layout_templates (id, slug, name, description, layout)
values
  (
    'slt-t8-332',
    'lecture-t8-332',
    'T자 8팀 · 6석 (앞3 / 중간3 / 뒤2)',
    'Lecture LiveOps 8팀 6석(총 48석)에 최적화된 Y축 보정형 T자 레이아웃',
    '{"zones":[{"id":"screen","label":"스크린","kind":"screen","x":35,"y":2,"w":30,"h":6},{"id":"desk","label":"강사석","kind":"desk","x":42,"y":10,"w":16,"h":5}],"tables":[{"label":"1팀","kind":"tshape","cx":25,"cy":26,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"1-1","ox":-6.55,"oy":-5.6},{"key":"1-2","ox":-6.55,"oy":1.4},{"key":"1-3","ox":6.55,"oy":-5.6},{"key":"1-4","ox":6.55,"oy":1.4},{"key":"1-5","ox":-4.3,"oy":14.1},{"key":"1-6","ox":4.3,"oy":14.1}]},{"label":"2팀","kind":"tshape","cx":50,"cy":26,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"2-1","ox":-6.55,"oy":-5.6},{"key":"2-2","ox":-6.55,"oy":1.4},{"key":"2-3","ox":6.55,"oy":-5.6},{"key":"2-4","ox":6.55,"oy":1.4},{"key":"2-5","ox":-4.3,"oy":14.1},{"key":"2-6","ox":4.3,"oy":14.1}]},{"label":"3팀","kind":"tshape","cx":75,"cy":26,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"3-1","ox":-6.55,"oy":-5.6},{"key":"3-2","ox":-6.55,"oy":1.4},{"key":"3-3","ox":6.55,"oy":-5.6},{"key":"3-4","ox":6.55,"oy":1.4},{"key":"3-5","ox":-4.3,"oy":14.1},{"key":"3-6","ox":4.3,"oy":14.1}]},{"label":"4팀","kind":"tshape","cx":25,"cy":54,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"4-1","ox":-6.55,"oy":-5.6},{"key":"4-2","ox":-6.55,"oy":1.4},{"key":"4-3","ox":6.55,"oy":-5.6},{"key":"4-4","ox":6.55,"oy":1.4},{"key":"4-5","ox":-4.3,"oy":14.1},{"key":"4-6","ox":4.3,"oy":14.1}]},{"label":"5팀","kind":"tshape","cx":50,"cy":54,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"5-1","ox":-6.55,"oy":-5.6},{"key":"5-2","ox":-6.55,"oy":1.4},{"key":"5-3","ox":6.55,"oy":-5.6},{"key":"5-4","ox":6.55,"oy":1.4},{"key":"5-5","ox":-4.3,"oy":14.1},{"key":"5-6","ox":4.3,"oy":14.1}]},{"label":"6팀","kind":"tshape","cx":75,"cy":54,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"6-1","ox":-6.55,"oy":-5.6},{"key":"6-2","ox":-6.55,"oy":1.4},{"key":"6-3","ox":6.55,"oy":-5.6},{"key":"6-4","ox":6.55,"oy":1.4},{"key":"6-5","ox":-4.3,"oy":14.1},{"key":"6-6","ox":4.3,"oy":14.1}]},{"label":"7팀","kind":"tshape","cx":33.33333333333333,"cy":82,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"7-1","ox":-6.55,"oy":-5.6},{"key":"7-2","ox":-6.55,"oy":1.4},{"key":"7-3","ox":6.55,"oy":-5.6},{"key":"7-4","ox":6.55,"oy":1.4},{"key":"7-5","ox":-4.3,"oy":14.1},{"key":"7-6","ox":4.3,"oy":14.1}]},{"label":"8팀","kind":"tshape","cx":66.66666666666666,"cy":82,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"8-1","ox":-6.55,"oy":-5.6},{"key":"8-2","ox":-6.55,"oy":1.4},{"key":"8-3","ox":6.55,"oy":-5.6},{"key":"8-4","ox":6.55,"oy":1.4},{"key":"8-5","ox":-4.3,"oy":14.1},{"key":"8-6","ox":4.3,"oy":14.1}]}]}'
  ),
  (
    'slt-t5-6-32',
    't5-6-32',
    'T자 5팀 · 6석 (앞3 / 뒤2)',
    'T자 5팀 6석(총 30석) 기존 호환 배치도',
    '{"zones":[{"id":"screen","label":"스크린","kind":"screen","x":35,"y":2,"w":30,"h":6},{"id":"desk","label":"강사석","kind":"desk","x":42,"y":10,"w":16,"h":5}],"tables":[{"label":"1팀","kind":"tshape","cx":25,"cy":30,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"1-1","ox":-6.55,"oy":-5.6},{"key":"1-2","ox":-6.55,"oy":1.4},{"key":"1-3","ox":6.55,"oy":-5.6},{"key":"1-4","ox":6.55,"oy":1.4},{"key":"1-5","ox":-4.3,"oy":14.1},{"key":"1-6","ox":4.3,"oy":14.1}]},{"label":"2팀","kind":"tshape","cx":50,"cy":30,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"2-1","ox":-6.55,"oy":-5.6},{"key":"2-2","ox":-6.55,"oy":1.4},{"key":"2-3","ox":6.55,"oy":-5.6},{"key":"2-4","ox":6.55,"oy":1.4},{"key":"2-5","ox":-4.3,"oy":14.1},{"key":"2-6","ox":4.3,"oy":14.1}]},{"label":"3팀","kind":"tshape","cx":75,"cy":30,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"3-1","ox":-6.55,"oy":-5.6},{"key":"3-2","ox":-6.55,"oy":1.4},{"key":"3-3","ox":6.55,"oy":-5.6},{"key":"3-4","ox":6.55,"oy":1.4},{"key":"3-5","ox":-4.3,"oy":14.1},{"key":"3-6","ox":4.3,"oy":14.1}]},{"label":"4팀","kind":"tshape","cx":33.33333333333333,"cy":70,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"4-1","ox":-6.55,"oy":-5.6},{"key":"4-2","ox":-6.55,"oy":1.4},{"key":"4-3","ox":6.55,"oy":-5.6},{"key":"4-4","ox":6.55,"oy":1.4},{"key":"4-5","ox":-4.3,"oy":14.1},{"key":"4-6","ox":4.3,"oy":14.1}]},{"label":"5팀","kind":"tshape","cx":66.66666666666666,"cy":70,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"5-1","ox":-6.55,"oy":-5.6},{"key":"5-2","ox":-6.55,"oy":1.4},{"key":"5-3","ox":6.55,"oy":-5.6},{"key":"5-4","ox":6.55,"oy":1.4},{"key":"5-5","ox":-4.3,"oy":14.1},{"key":"5-6","ox":4.3,"oy":14.1}]}]}'
  ),
  (
    'slt-eight-team-8-6',
    'eight-team-8-6',
    'Generic 8조 · 6석 (4/4 배치)',
    'Generic AI교육 기본 8조 6석(총 48석) 배치도',
    '{"zones":[{"id":"screen","label":"스크린","kind":"screen","x":35,"y":2,"w":30,"h":6},{"id":"desk","label":"강사석","kind":"desk","x":42,"y":10,"w":16,"h":5}],"tables":[{"label":"1조","kind":"tshape","cx":14,"cy":33,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"1-1","ox":-6.55,"oy":-5.6},{"key":"1-2","ox":-6.55,"oy":1.4},{"key":"1-3","ox":6.55,"oy":-5.6},{"key":"1-4","ox":6.55,"oy":1.4},{"key":"1-5","ox":-4.3,"oy":14.1},{"key":"1-6","ox":4.3,"oy":14.1}]},{"label":"2조","kind":"tshape","cx":38,"cy":33,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"2-1","ox":-6.55,"oy":-5.6},{"key":"2-2","ox":-6.55,"oy":1.4},{"key":"2-3","ox":6.55,"oy":-5.6},{"key":"2-4","ox":6.55,"oy":1.4},{"key":"2-5","ox":-4.3,"oy":14.1},{"key":"2-6","ox":4.3,"oy":14.1}]},{"label":"3조","kind":"tshape","cx":62,"cy":33,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"3-1","ox":-6.55,"oy":-5.6},{"key":"3-2","ox":-6.55,"oy":1.4},{"key":"3-3","ox":6.55,"oy":-5.6},{"key":"3-4","ox":6.55,"oy":1.4},{"key":"3-5","ox":-4.3,"oy":14.1},{"key":"3-6","ox":4.3,"oy":14.1}]},{"label":"4조","kind":"tshape","cx":86,"cy":33,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"4-1","ox":-6.55,"oy":-5.6},{"key":"4-2","ox":-6.55,"oy":1.4},{"key":"4-3","ox":6.55,"oy":-5.6},{"key":"4-4","ox":6.55,"oy":1.4},{"key":"4-5","ox":-4.3,"oy":14.1},{"key":"4-6","ox":4.3,"oy":14.1}]},{"label":"5조","kind":"tshape","cx":14,"cy":66,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"5-1","ox":-6.55,"oy":-5.6},{"key":"5-2","ox":-6.55,"oy":1.4},{"key":"5-3","ox":6.55,"oy":-5.6},{"key":"5-4","ox":6.55,"oy":1.4},{"key":"5-5","ox":-4.3,"oy":14.1},{"key":"5-6","ox":4.3,"oy":14.1}]},{"label":"6조","kind":"tshape","cx":38,"cy":66,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"6-1","ox":-6.55,"oy":-5.6},{"key":"6-2","ox":-6.55,"oy":1.4},{"key":"6-3","ox":6.55,"oy":-5.6},{"key":"6-4","ox":6.55,"oy":1.4},{"key":"6-5","ox":-4.3,"oy":14.1},{"key":"6-6","ox":4.3,"oy":14.1}]},{"label":"7조","kind":"tshape","cx":62,"cy":66,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"7-1","ox":-6.55,"oy":-5.6},{"key":"7-2","ox":-6.55,"oy":1.4},{"key":"7-3","ox":6.55,"oy":-5.6},{"key":"7-4","ox":6.55,"oy":1.4},{"key":"7-5","ox":-4.3,"oy":14.1},{"key":"7-6","ox":4.3,"oy":14.1}]},{"label":"8조","kind":"tshape","cx":86,"cy":66,"w":15,"h":5.5,"stemW":5.5,"stemH":10,"seats":[{"key":"8-1","ox":-6.55,"oy":-5.6},{"key":"8-2","ox":-6.55,"oy":1.4},{"key":"8-3","ox":6.55,"oy":-5.6},{"key":"8-4","ox":6.55,"oy":1.4},{"key":"8-5","ox":-4.3,"oy":14.1},{"key":"8-6","ox":4.3,"oy":14.1}]}]}'
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  layout = excluded.layout,
  updated_at = now();
