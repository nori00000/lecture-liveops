-- 0010: 관찰 로그 해결완료 플래그
-- '해결'(solution 카테고리 = 해결안이 기록된 내용)과 '해결완료'(해결 버튼으로 종료 처리)를 구분한다.
-- resolved=true 인 항목은 관찰로그에 연한 초록 '해결완료' 배지로 표시되고,
-- RoleActionPanel(메인/보조 우선순위)과 상황 스냅샷(위험도/블로커 집계)에서 제외된다.
-- 기존 행은 default false 로 채워지므로 backfill 불필요. 기존(구버전) 코드는 이 컬럼을 참조하지 않아 안전하다.
alter table live_observations add column if not exists resolved boolean default false;
