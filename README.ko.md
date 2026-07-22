# Lecture LiveOps

Lecture LiveOps는 강의 현장과 숙의 워크숍을 운영하기 위한 퍼실리테이터 콘솔입니다.

현재 제품의 중심은 숙의 워크플로우입니다. 참가자는 access key로 입장해 의견을 제출하고 찬성/반대/유보 투표를 합니다. 퍼실리테이터는 합의점, 쟁점, 소수의견, moderation 로그, 근거 유형 분포, 품질 게이트 지표가 연결된 절차 증빙형 리포트를 납품할 수 있습니다.

## 현재 상태

- 숙의 MVP 0-4단계 구현 완료.
- Post-MVP 의견 지형 통계는 통계 게이트 뒤에 구현 완료.
- 전사 동의와 스키마 기반은 구현 완료. 전사 ingest 파이프라인은 의도적으로 아직 미구현.
- 숙의 품질 지원 Q1-Q4 구현 완료.
- Q5 공통지반 자연어 요약은 파일럿 실측으로 선행 품질 기준을 통과한 뒤 착수.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

기본 개발 경로는 DB 없이 fixture mode로 동작합니다.

프로덕션 모드는 fail-closed입니다. `DATABASE_URL`은 Neon/Postgres를 가리켜야 하고, `AUTH_SECRET`도 필요합니다. 로컬에서 production build를 확인할 때도 환경변수를 넣어야 합니다.

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/liveops AUTH_SECRET=local-build-secret npm run build
```

## 주요 스크립트

```bash
npm run dev           # Next.js dev server, port 3010
npm run lint          # ESLint
npm run typecheck     # TypeScript
npm test              # Vitest
npm run build         # Production build, production env 필요
npm run seed:demo     # 결정론적 숙의 데모 시드
```

## 핵심 문서

- `docs/PRODUCT-PLAN-v2.md` — 제품 계획과 현재 로드맵
- `docs/DELIBERATION-QUALITY-PLAN.md` — Q1-Q6 숙의 품질 계획
- `docs/facilitator-runbook.md` — 현장 운영 런북
- `docs/privacy-template.md` — 개인정보 고지문 템플릿
- `docs/transcript-architecture.md` — 전사 동의와 향후 ingest 아키텍처

## 최근 검증

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `DATABASE_URL=postgres://user:pass@localhost:5432/liveops AUTH_SECRET=build-secret-for-local-check npm run build`

## 라이선스

MIT
