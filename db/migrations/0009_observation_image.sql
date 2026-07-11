-- 0009: 관찰 로그 스크린샷 첨부 + 대상 태그(메인/보조강사)
-- image_data: 드래그앤드롭/붙여넣기 이미지를 클라이언트 리사이즈 base64 data URL로 저장.
-- audience: 'main'|'assistant'|'both' — 메인강사/보조강사 둘 다 태그 가능(둘 다 알아야 할 항목).
alter table live_observations add column if not exists image_data text;
alter table live_observations add column if not exists audience text;
