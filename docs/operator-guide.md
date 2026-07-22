# 서비스 운영자 가이드

> 대상: Lecture LiveOps 숙의 워크숍을 시연하거나 실제 파일럿을 운영하는 퍼실리테이터·운영 지원자.
> 목적: 결과물을 어디서 확인하고, 어떤 화면을 보고, 어떤 파일을 납품하면 되는지 한 번에 확인한다.

## 1. 로컬 데모 실행

개발·시연 환경에서는 DB 없이 fixture mode로 실행할 수 있다.

```bash
LIVEOPS_RATE_LIMIT_DISABLE=1 npm run dev
```

서버가 준비되면 다른 터미널에서 데모 워크숍을 만든다.

```bash
LIVEOPS_BASE_URL=http://127.0.0.1:3010 npm run seed:demo
```

시드가 끝나면 아래 형태의 접속 정보가 출력된다.

```text
sessionId       : se-...
운영자 콘솔      : http://127.0.0.1:3010/workshops/{sessionId}/console
워크숍 설정      : http://127.0.0.1:3010/workshops/{sessionId}/settings
프로젝터 결과판  : http://127.0.0.1:3010/workshops/{sessionId}/projector
참가자 입장      : http://127.0.0.1:3010/p/enter
리포트 다운로드:
  md  : http://127.0.0.1:3010/api/export/delib?sessionId={sessionId}&format=md
  html: http://127.0.0.1:3010/api/export/delib?sessionId={sessionId}&format=html
  xlsx: http://127.0.0.1:3010/api/export/delib?sessionId={sessionId}&format=xlsx
```

운영자 게이트가 켜진 환경에서는 `/admin/login`에서 운영자 인증을 먼저 완료한다. 개발 모드에서 `LIVEOPS_OPERATOR_KEY`를 설정하지 않으면 운영자 게이트는 비활성이다. 프로덕션은 항상 fail-closed이므로 `LIVEOPS_OPERATOR_KEY`, `DATABASE_URL`, `AUTH_SECRET`을 설정하고 배포한다.

## 2. 화면별 확인 포인트

### 운영자 콘솔

경로: `/workshops/{sessionId}/console`

확인할 것:

- 상단에 세션 제목, 날짜, 현재 라운드, 참가자 수가 보인다.
- `라운드 제어`에서 현재 active 라운드와 이전 closed 라운드가 보인다.
- `프로젝터 발행`에서 스냅샷 계산·발행을 실행한다.
- `결과 리포트 내려받기`에서 Markdown, HTML, Excel을 내려받는다.
- `검토 후보 (리포트용)`은 Q2 사후 검토 후보다. 참가자/프로젝터에는 보이지 않고 승인한 항목만 리포트에 들어간다.
- `투표 진행률`은 전체 집계 진행률이다. 개인 표는 표시하지 않는다.
- `근거 유형 분포`는 참가자 자기 태깅(Q1)만 집계한다. 소표본·차분 복원 위험이 있으면 억제된다.
- `앱 제출 분포`는 저장된 텍스트 제출만 센다. 구두 발언량이 아니다.
- `그룹 보드`는 익명 모드에서는 anon handle만 보여준다.
- `Moderation 큐`에서 신고/숨김/복원을 처리한다.
- `오프라인 대리 입력`은 폰 없는 참가자·종이 제출 대응용이다. 대리입력 근거 유형은 참가자 자기 태깅으로 보지 않는다.

캡처 예시:

- `operator-console-top`: 라운드 제어, 프로젝터 발행, 리포트 다운로드, Q2 검토 후보, 투표 진행률.
- `operator-console-distribution-moderation`: 앱 제출 분포, 그룹 보드, moderation 큐, 전체 발언.

### 프로젝터 결과판

경로: `/workshops/{sessionId}/projector`

참가자 전체 화면에 띄우는 결과판이다. 운영자가 `결과 계산 & 발행`을 실행한 뒤 표시된다.

확인할 것:

- 상단에 전체 찬성/반대/유보 집계가 보인다.
- `공감대`는 합의 강도가 높은 발언이다.
- `쟁점`은 찬반이 팽팽한 발언이다.
- `소수 관점`은 전체 다수 방향과 다른 관점이다. 개인이나 집단을 지목하지 않는다.
- `의견 지형`은 60명 이상에서만 활성화된다. 소규모 데모에서는 비활성 사유가 표시되는 것이 정상이다.
- 유효표 부족(k 미만) 항목은 결과에서 제외되고 하단에 억제 안내가 표시된다.

캡처 예시:

- `projector-results`: 공감대·쟁점·소수 관점·의견 지형 비활성 안내.

### 결과 리포트

경로:

```text
/api/export/delib?sessionId={sessionId}&format=md
/api/export/delib?sessionId={sessionId}&format=html
/api/export/delib?sessionId={sessionId}&format=xlsx
```

납품 파일이다. 운영자 전용이며, `LIVEOPS_OPERATOR_KEY`가 설정된 환경에서는 미들웨어와 라우트 내부 2차 검증으로 보호된다.

확인할 것:

- 행사 개요: 세션, 일시, 장소, 참가자 수, 라운드 수, 발언 수.
- 절차 설정: 익명 모드, 공개 범위, 보관 기간, 미성년자 세션 여부, 사전 합의.
- 숙의 품질 게이트:
  - Q1 추정 태그 비율.
  - Q2 후보 채택률.
  - Q5 착수 조건.
- 라운드별 결과: 합의점, 쟁점, 소수의견, 의견 지형, 근거 유형 분포.
- Moderation 내역: 신고/숨김/복원 감사 로그.
- 원자료: statement별 집계와 원문. 개인 투표 원자료는 포함하지 않는다.
- 승인된 Q2 검토 후보가 있으면 `검토가 필요한 주장` 섹션이 추가된다. 승인 0건이면 섹션 자체가 없다.

캡처 예시:

- `html-report-quality-gates`: 리포트 개요와 숙의 품질 게이트.

## 3. 실제 운영 순서

1. 세션을 만든다.
2. `/workshops/{sessionId}/settings`에서 프라이버시 설정을 확정한다.
3. 익명/기명 모드, 공개 범위, 보관 기간, 사전 합의 여부를 확인한다.
4. 그룹과 참가자를 준비한다.
5. 프로젝터 기기에서 `/workshops/{sessionId}/projector`를 연다.
6. 참가자에게 `/p/enter` QR과 access key를 배포한다.
7. 라운드를 열고 발언·투표를 받는다.
8. 라운드 종료 전 콘솔에서 투표 진행률과 앱 제출 분포를 확인한다.
9. 필요한 경우 moderation 큐에서 신고/숨김/복원을 처리한다.
10. 종합 시점에 `결과 계산 & 발행`을 실행한다.
11. 프로젝터 결과판을 보고 합의점·쟁점·소수 관점을 설명한다.
12. 세션 종료 후 `검토 후보 생성`을 실행하고, 필요한 후보만 승인한다.
13. Markdown, HTML, Excel 리포트를 내려받아 납품한다.

## 4. 납품 전 검수 체크리스트

- [ ] 프로젝터 결과판에 공감대·쟁점·소수 관점이 표시된다.
- [ ] 소표본 항목은 수치가 노출되지 않거나 결과에서 제외된다.
- [ ] moderation 큐에 신고 항목이 있으면 처리 상태가 의도와 맞다.
- [ ] 원자료에 개인 투표 원자료가 없다.
- [ ] 익명 모드 리포트에서 작성자가 실명/반복 핸들로 연결되지 않는다.
- [ ] Q2 검토 후보는 승인한 항목만 리포트에 들어간다.
- [ ] 숙의 품질 게이트가 리포트 개요에 표시된다.
- [ ] 리포트 3형식(md/html/xlsx)을 모두 열 수 있다.

## 5. 문제 해결

### `npm run build`가 `DATABASE_URL` 없음으로 실패한다

정상 동작이다. 프로덕션 모드는 fixture fallback을 막는다. build/deploy에는 `DATABASE_URL`과 `AUTH_SECRET`을 설정한다.

```bash
DATABASE_URL=postgres://user:pass@host:5432/db AUTH_SECRET=... npm run build
```

### `npm run seed:demo`가 서버 헬스체크에서 실패한다

서버가 아직 준비되지 않았거나 localhost 접근이 막힌 것이다.

1. dev 서버 로그에서 `Ready`를 확인한다.
2. `curl http://127.0.0.1:3010/api/health`가 `ok:true`인지 확인한다.
3. 필요하면 `LIVEOPS_BASE_URL=http://127.0.0.1:3010 npm run seed:demo`로 실행한다.

### Q1 근거 유형 분포가 많이 억제된다

정상일 수 있다. 기여자 수가 작거나 작은 셀/차분 복원 위험이 있으면 분포 전체를 숨긴다. 리포트에는 억제 사유가 절차 증빙으로 남는다.

### 앱 제출 분포가 낮다

앱에 저장된 텍스트 제출이 적다는 뜻이다. 구두 발언량을 의미하지 않는다. 현장 관찰과 종이 제출 회수 여부를 함께 확인한다.

### Q5 착수 조건이 `실측 부족`이다

정상이다. Q5 공통지반 자연어 요약은 Q2 후보 채택률과 파일럿 수정률 게이트를 통과한 뒤 착수한다.
