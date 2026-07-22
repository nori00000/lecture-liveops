-- 0021: moderation_events 감사 주체에 operator 상수 허용
--
-- 배경(M3): operator gate 는 admin/instructor/assistant 세부 role 이 아니라
-- "운영자 권한 집합"만 검증한다. 클라이언트가 주장한 세부 role 을 감사 로그에
-- 저장하면 없는 정보를 있는 척 남기게 되므로, 서버가 확인 가능한 값인 operator 로 정규화한다.

alter table moderation_events
  drop constraint if exists moderation_events_actor_role_check;

alter table moderation_events
  add constraint moderation_events_actor_role_check
  check (actor_role in ('admin', 'instructor', 'assistant', 'participant', 'operator'));
