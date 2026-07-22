# 음성 전사 → 워크숍 지식 아카이브 — 설계 동결본 (Post-MVP A)

> 2026-07-22. architect(opus) 설계 + 메인 세션 확인 사실 반영.
> **상태: 동의·보안 기반 착수 완료 / 전사 ingest 파이프라인은 미착수.** 남은 착수 게이트는 §7. 이 문서는 "지금 팔아도 되는 문장의 상한선"을 겸한다.

## 0. 무엇이 열렸고 무엇이 아직 막혀 있나

**제품 오너 결정(2026-07-22)**: "전사를 수집하는 것으로 동의를 받고 전사를 수집한다." 이에 따라 아래 3번 게이트(고지문 모순)는 **해소**되었다.

이번에 지은 것 (동의·보안 기반):
- `docs/privacy-template.md` — "전사 수집 안 함" → **"테이블 단위 전사를 수집한다 + 동의 절차 + 미동의자 보호"**로 개정
- `docs/data-retention-policy.md` §2-1/§2-2 — 전사 텍스트 7일, 원음성 현장 기기 24h 자동 삭제 + 삭제 증빙 로그
- `privacy_settings.recordingConsent` / `recordingConsentAt` / `offsiteProcessing`(기본 false) + 서버 게이트 `enforceRecordingConsent()`
- 참가자 화면·콘솔 "녹음 중" 상시 배너, 워크숍 설정의 녹음 동의 토글·고지 문구
- `db/migrations/0017_transcript_consent.sql` — 전사 3종 테이블 **스키마·RLS** (오디오 경로 컬럼 없음)
- 운영자 콘솔 `라이브 전사 렌즈` — `transcript_segments`가 있으면 전사 흐름을 읽어 키워드·그룹 발화량·질문/동의/반대/우려 신호를 시각화한다. 아직 ingest가 없을 때는 제출 발언 기반 `전사 미연결 프리뷰`로 명확히 표시한다

아직 막혀 있는 것 (§7 잔여 게이트):
1. `PRODUCT-PLAN-v2.md` §9가 전사 레이어를 **"유료 2~3건 이후"**로 명시 — **유효**
2. `PRODUCT-PLAN-v2.md` §10 pre-mortem 3번 **"AI 전사·클러스터링을 고객에게 약속하지 말라"** — **유효**(상시 점검)
3. ~~고지문이 "전사 수집 안 함"이라 코드가 먼저 나가면 고지 위반~~ → **해소**(고지문·보관정책 개정 완료). 단 개정본은 여전히 **법무 검토 전**이며, 실제 워크숍 사용 전 `[검토 필요]` 항목을 채워야 한다
4. 실측 미완: 한국어 다인 발화 정확도(§6-1)를 실제 회의실에서 1회도 재보지 않았다 — **유효**
5. 세션 스코프 ingest 토큰 설계 미확정 — **유효**

## 1. 컴포넌트 배치 (판정: 오디오는 현장 박스를 떠나지 않는다)

```
[테이블 1..N] 바운더리 마이크 1개/테이블
      │  ← 오디오는 이 선을 넘지 않음
[현장 전사 박스] 노트북 1대 (M1 Pro 16GB급)
  · WhisperLive 서버 (MIT, faster-whisper large-v3, ko)
  · 테이블별 클라이언트 → device 태깅
  · 로컬 디스크에만 wav + 세션 마크다운
  · uploader: 텍스트 세그먼트만 5~15초 배치 POST
      │  HTTPS · 텍스트 only
[Vercel + Neon] ingest API → transcript_segments → 콘솔 · 승격 게이트
```

- **기각된 안**: Tailscale로 m4-studio에 실시간 오디오 전송 — 영업 화법("민감 원음성은 현장을 떠나지 않습니다")을 배선 자체가 반증하고, 현장 업링크에 실시간 의존성을 만든다
- **m4-studio의 남은 역할 2가지**: (a) 개발·모델 튜닝 환경, (b) **텍스트 후처리 오프로드**(현장 박스가 만든 텍스트를 로컬 LLM으로 논거 추출) — 다운되면 요약 지연일 뿐 전사 손실 0
- 오프사이트 처리는 별도 계약 조항 + `privacy_settings.offsiteProcessing=true` 세션 플래그를 요구하고 **기본값 false로 코드에서 거부**

## 2. 스키마 (`0017_transcript_consent.sql` 로 적용 완료 — 기존 0014/0015 수정 금지)

기존 `statements`에 컬럼을 추가하지 않고 provenance를 옆 테이블로 분리:

| 테이블 | 역할 |
|---|---|
| `transcript_sources` | (session_id, group_id, device_label, started_at, ended_at, consent_confirmed_at) — 분임↔녹음기기 매핑 |
| `transcript_segments` | (source_id, round_id, speaker_tag, started_ms, ended_ms, text, confidence) — `speaker_tag`는 화자분리 결과가 아니라 **테이블 라벨**('T3'). **오디오 경로·파일명 컬럼을 의도적으로 만들지 않는다** |
| `transcript_insights` | LLM 논거 추출 후보 (body, kind, evidence_segment_ids[], status pending/approved/rejected, promoted_statement_id) |

- 멱등성: `unique(source_id, started_ms)` — 재전송 안전
- **승격 게이트**: 승인된 insight만 `statements.submit()`으로 승격, `author_participant_id=null`·`visibility='group'`로 기존 집계·모더레이션 파이프라인을 그대로 탄다. 사람 승인 없이는 statements에 아무것도 못 들어간다(Gobi PBU 패턴)
- **AI 라벨**: 승격 statement는 `promoted_statement_id` 역참조로 UI가 "AI 정리 초안" 배지 + 근거 세그먼트 링크 — §7-5 거버넌스를 스키마로 만족
- RLS: transcript_* 3종 select는 operator 이상만(참가자 열람 금지), insert는 서버 경로 전용

## 3. 실시간성 — 신규 인프라 0

기존 폴링 축을 그대로 쓴다(콘솔 3초·프로젝터 4초·참가자 12초). 전사 박스가 5~15초 배치로 Neon upsert → `/api/data/delib/transcript-view`(operator 전용, `/api/data` 하위라 미들웨어 게이트 자동 적용) → 콘솔 `라이브 전사 렌즈` SWR 폴링. 현재 route는 read-only이며, 실제 전사 segment가 없으면 제출 발언을 프리뷰로 변환한다. 커서 기반 증분(`?since=`)은 ingest 착수 시 추가한다. **SSE·WebSocket·외부 릴레이 불필요** — 체감 지연은 폴링이 아니라 WhisperLive 자체 지연이 지배한다.

## 4. 프라이버시를 문서가 아니라 구조로 강제

- **구조적 불가능**: SaaS 스키마에 오디오 URI/파일명 컬럼을 만들지 않고 ingest zod를 `.strict()`로 — 알 수 없는 키는 400. "원음성 미반출"이 정책이 아니라 타입이 된다
- **인증**: 기존 서버-서버 경로(`LIVEOPS_SERVER_API_KEY` + `x-liveops-api-key`) 재사용. 단 전역 키 1개가 전 세션 쓰기 권한이 되면 안 되므로 **세션 스코프 ingest 토큰**을 세션 생성 시 발급해 함께 요구 — 착수 시 필수 조건
- **동의 게이트**: `privacy_settings.recordingConsent`(+`recordingConsentAt`) 없으면 ingest 403. 콘솔 "녹음 중" 상시 배너 + 참가자 화면 표기
- **삭제**: 현장 박스는 세션 종료 후 기본 24h wav 자동 삭제(삭제 로그는 텍스트로 증빙). Neon의 transcript_segments는 **statements보다 짧은 기본 보관기간(7일 제안)** — 원자료는 statements라는 제품 원칙과 일치

## 5. MVP 최소 스코프 (팔 수 있는 최소)

**T0**: 실시간 화자분리 없음. 테이블당 마이크 1개 → **라운드 종료 시 일괄 전사** → 테이블별 전사 텍스트가 콘솔에 표시 → 라운드 종료 시 테이블별 "논점 3~5개" 초안 → 퍼실리테이터 승인분만 statements 승격. 납품물은 기존 리포트에 "테이블별 대화 요약" 1장 추가.

**판매 문장의 상한**: "발언자를 특정하지 않는 **테이블 단위** 논의 요약". 개인 귀속·정확한 인용은 약속 금지(마이크 1개/테이블에서 화자분리는 구조적으로 신뢰 불가).

로드맵: T1 준실시간 스트리밍 표시(T0에서 지연 불만이 실증되면) → T2 세션 간 지식 아카이브 → T3 화자분리(하드웨어 원가·동의 난이도 급증, 별도 사업판단).

## 6. 리스크

1. **한국어 다인 발화 정확도 (HIGH)** — 회의실 소음+동시발화에서 WER 급락. 완화: 바운더리 마이크 물리 배치, large-v3 고정, initial_prompt에 세션 주제어 주입. **파일럿 전 실제 회의실 1회 사전 실측 없이 판매 금지**
2. **약속 초과 (HIGH, 사업적)** — 전사가 붙는 순간 고객은 "AI가 정리해준다"로 이해. 계약서·리포트에 "AI 초안, 사람 승인" 라벨 고정
3. **현장 박스 운영 부담 (MED, 1인)** — 완화: 단일 `start-workshop.sh` + 오디오 레벨 헬스체크 1개, 실패 시 전사 없이 진행(제품이 degrade하도록). **전사 박스를 크리티컬 패스에 올리는 배선 금지**
4. **m4-studio 단일 장애점 (LOW)** — 텍스트 후처리 오프로드일 뿐이라 다운 시 요약 지연만
5. **라이선스 (해소됨)** — `jykim/AI4PKM`·`rbx-labs/ai4pkm-cli` 모두 **LICENSE 파일 없음(GitHub API 404 실측, 2026-07-22)**. pyproject의 MIT 표기만으론 재배포 근거 불충분 → **코드 리프트 금지, 패턴만 참조해 자체 구현**

## 7. 착수 게이트 (ingest 파이프라인 착수 조건 — 아래 전부 충족 전 ingest 코드 금지)

상태 갱신 2026-07-22. 동의·보안 기반(§0)과 운영자 콘솔의 read-only 전사 렌즈는 선행 완료 — 게이트가 지키는 대상은 **전사 ingest·WhisperLive 연동·현장 박스**다.

1. ⏳ 유료 파일럿 **2건 이상** 완료 (기획서 §9 "유료 2~3건 이후")
2. ⏳ 그 파일럿에서 고객이 **전사·요약을 실제로 요구**했다는 근거(요청 기록·추가 지불의사)
3. ⏳ 실제 회의실 환경 한국어 전사 **1회 사전 실측** 완료 및 WER 수용 가능 판정
4. ✅ `docs/privacy-template.md`·`data-retention-policy.md` 개정 완료 (2026-07-22) — 단 **법무 검토는 미완**(`[검토 필요]` 잔존)
5. ⏳ 세션 스코프 ingest 토큰 설계 확정 (§8 남은 결정)

## 8. 남은 결정 (착수 시점에)

- 세션 스코프 ingest 토큰 저장 위치: `access_keys` 재사용 vs `sessions.metadata` 신규 필드
- 전사 텍스트 보관기간 기본값(7일 제안)의 법무 검토 → `data-retention-policy.md`의 `[검토 필요]` 항목에 편입
- LLM 논거추출을 m4-studio 로컬(EXAONE)로 할지 클라우드 API로 할지 — **로컬이면 "텍스트도 외부 LLM에 가지 않습니다"가 영업 문장으로 추가 가능(권장)**
