# Dialogue Lens — 대화 상태 시각화 제품면

> 2026-07-25. 기존 Lecture LiveOps 운영 콘솔에서 분기한 별도 product surface.
> 목표는 AI가 사람을 채점하지 않고, 대화의 상태를 보여줘서 참여자가 스스로 조정하게 하는 것이다.

## 0. 적대적 크리틱에서 바뀐 결론

기존 계획의 약점은 "참가자 대면 실시간 논리 오류 판정 금지"를 너무 넓게 적용해, 안전한 실시간 대화 상태 시각화까지 보류했다는 점이다.

수정된 원칙:

- 금지: 사람·그룹·진영을 향한 오류 판정, 점수, 순위, 경고.
- 허용: 발화 흐름에서 관찰 가능한 상태를 익명·비평가적 언어로 보여주기.

AI는 평가자가 아니라 대화의 계기판이다.

## 1. 제품 정의

**Dialogue Lens는 민주적 의사결정 훈련을 위한 Conversation Mirror다.**

참여자가 말하는 동안 전사 흐름을 바탕으로 다음 상태를 보여준다.

- 열린 질문: 질문이 나왔지만 아직 충분히 다뤄지지 않은 지점.
- 정의 확인: 같은 말이 서로 다른 맥락에서 쓰이는 지점.
- 근거 연결: 주장과 근거 표현이 이어졌는지 확인할 지점.
- 갈림 축: 찬반이 아니라 가치 기준이 갈리는 축.
- 합의 후보: 여러 발화에서 반복되는 공통 표현.

## 2. UI 언어 규칙

금지어:

- 논리 오류
- 틀린 주장
- 근거 없음
- 비합리적
- AI 판정
- 위험 발언
- 오류 점수

허용어:

- 확인해 볼 지점
- 연결 대기
- 정의 확인
- 열린 질문
- 반복되는 우려
- 갈림 축
- 합의 후보

## 3. Surface 분기

기존 surface:

- `/workshops/{sessionId}/console`: 운영자 콘솔. 라운드, 투표, moderation, 리포트.
- `/workshops/{sessionId}/projector`: 결과 발표.

신규 surface:

- `/dialogue/{sessionId}/live`: 대화 상태 시각화. 운영 버튼보다 전사 흐름과 mirror가 먼저 보인다.
- `/api/data/dialogue/live`: Dialogue Lens 전용 read-only payload.

## 4. 구현 상태

현재 구현:

- `lib/dialogue/stateMap.ts`: 규칙 기반 Conversation Mirror.
- `/api/data/dialogue/live`: 전사 segment 또는 statement preview를 mirror payload로 변환.
- `/dialogue/{sessionId}/live`: 대화 흐름 + 열린 질문/정의 확인/근거 연결/갈림 축/합의 후보 화면.

아직 미구현:

- 실제 WhisperLive ingest.
- LLM 기반 후보 생성.
- 진행자 승인 후 participant/projector 공개.
- 대화 후 review 화면.

## 5. 다음 개발 순서

1. 실제 대화형 transcript demo seed 추가.
2. `/dialogue/{sessionId}/live` 화면을 현장 projector 크기로 검증.
3. 열린 질문/정의 확인 품질을 파일럿 transcript로 조정.
4. LLM은 `확인 후보` 생성으로만 도입하고, public projection은 진행자 승인 후에만 허용.

## 6. Must Never Happen

- 참가자 개인 또는 그룹을 "오류가 많다"는 방식으로 보여주면 안 된다.
- AI 산출물이 진행자 승인 없이 참가자 전체 화면에 판단처럼 표시되면 안 된다.
- 전사 불확실성이 높은 내용을 확정 사실처럼 보여주면 안 된다.
- 운영 콘솔에 묻혀 Dialogue Lens가 다시 보조 패널로 후퇴하면 안 된다.
