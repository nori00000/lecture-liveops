-- Lecture LiveOps — 발언 근거 유형 자기 태깅 (Q1)
-- 근거: docs/DELIBERATION-QUALITY-PLAN.md §2 Q1.
--   "미검증 단정"을 **판정 없이** 가시화한다 — AI 판정 0, 오탐 0.
--   참가자 본인이 자기 발언의 근거 유형을 고른다: 경험 / 자료·출처 / 추정.
--
-- 설계 결정:
--   * nullable — 선택은 **선택사항**이다(강제하면 제출 마찰). 기존 행·운영자 대리입력도 미지정 허용.
--   * check constraint 로 값 집합을 DB 에서 고정 (애플리케이션 zod 와 이중 방어).
--   * RLS 변경 없음 — statements 기존 정책(0014/0012/0015)을 그대로 상속한다. 컬럼 추가는 정책에 영향 없음.
--   * 0014~0017 은 수정하지 않는다 (적용 완료 마이그레이션 불변).

alter table statements add column if not exists evidence_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'statements_evidence_kind_check'
  ) then
    alter table statements
      add constraint statements_evidence_kind_check
      check (evidence_kind is null or evidence_kind in ('experience', 'source', 'estimate'));
  end if;
end $$;

-- 집계(라운드·그룹별 분포)는 세션 단위 조회 후 메모리에서 수행하므로 별도 인덱스를 만들지 않는다.
-- 끝.
