-- Lecture LiveOps — Q2 AI 후보 중복 방지.
-- rejected 는 감사 이력으로 남기되, 같은 세션/발언/kind 의 active 후보(pending/approved)는 하나만 허용한다.

create unique index if not exists round_ai_observations_active_unique_idx
  on round_ai_observations(session_id, statement_id, kind)
  where status <> 'rejected';
