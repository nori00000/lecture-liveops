-- Lecture LiveOps — 의견 지형(landscape) 투표행렬 RPC
-- 통계 하드닝 이중 검증(2026-07-22) C1 대응. 0014/0015 는 수정 금지 — 추가는 전부 여기.
-- 전제: 0002 helper functions + 0004 liveops_anon + 0014 숙의 코어 + 0015 하드닝.
--
-- 문제: votes.matrixForClustering 이 Neon 에서 admin 만 허용했는데(RLS ax_delib_votes_admin_read),
--   computeSnapshot 은 instructor/assistant 도 호출한다 → 프로덕션 운영자 경로에서 항상
--   vote_matrix_unavailable 로 지형이 죽었다. fixture 테스트만 초록이었다.
--
-- 해법: delib_vote_tally 와 같은 패턴의 SECURITY DEFINER 함수.
--   - 세션 소속 검증: statements join + liveops_can_read_session (타 세션 표 유출 차단)
--   - 운영자 역할만: admin/instructor/assistant. participant 는 0행.
--   - search_path 고정, PUBLIC execute 회수, liveops_anon 에만 grant.
--
-- 거버넌스 §7-2: 반환값(개인 표)은 서버 메모리 안 클러스터링 입력으로만 쓰이고
-- 응답/스냅샷 payload 에는 절대 실리지 않는다 (lib/db/repo/votes.ts 주석 참조).

create or replace function public.delib_vote_matrix(p_statement_ids text[])
returns table(id text, statement_id text, participant_id text, vote text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select v.id, v.statement_id, v.participant_id, v.vote, v.created_at
  from statement_votes v
  join statements s on s.id = v.statement_id
  where v.statement_id = any(p_statement_ids)
    and public.liveops_role() in ('admin', 'instructor', 'assistant')
    and public.liveops_can_read_session(s.session_id)
$$;
revoke all on function public.delib_vote_matrix(text[]) from public;
grant execute on function public.delib_vote_matrix(text[]) to liveops_anon;

-- 끝.
