// Lecture LiveOps — Dialogue(트랙 B) 노출 게이트
//
// 이 모듈은 "무엇을 읽어도 되는가"만 판정한다(순수 함수, DB 접근 없음).
// live/projector 두 라우트가 **같은 판정**을 쓰도록 한 곳에 모은 이유:
// 게이트가 라우트별로 복제되면 한쪽만 고쳐지고 다른 쪽이 조용히 새는 사고가 반복됐다.
//
// 근거 문서: docs/transcript-architecture.md §4(동의 게이트), docs/DIALOGUE-LENS-PRODUCT.md Must-Never.

import type { StatementVisibility, TranscriptSource } from '@/lib/db/schema'

/**
 * C2 (전사 동의 우회 차단) — 전사 **read** 선행 조건.
 *
 * 기존 결함: 동의 게이트가 ingest 경로에만 있었고 read 경로에는 없었다. 그래서
 * `recordingConsent=false` 이거나 source 의 `consent_confirmed_at` 이 null 이어도
 * 이미 적재된 전사 원문이 화면에 그대로 떴다(동의 철회가 무의미해짐).
 *
 * 판정은 두 층을 **모두** 통과해야 한다:
 *  1. 세션 층: `recording.active`(privacySettings.recordingConsent)가 true.
 *  2. 소스 층: 해당 녹취 소스가 `consent_confirmed_at` 을 가진다.
 *
 * fail-closed: 어느 한쪽이라도 불확실하면 빈 배열 — 노출보다 미표시가 안전하다.
 */
export function gateTranscriptSources(recordingActive: boolean, sources: TranscriptSource[]): TranscriptSource[] {
  if (!recordingActive) return []
  return sources.filter((s) => s.consent_confirmed_at != null)
}

/**
 * C3 (projector 그룹 발언 노출 차단) — 방 전체 화면에 띄울 수 있는 발언인지.
 *
 * 기존 결함: projector 가 `visibleOnly:true`(= moderation 통과)만 걸러서
 * `visibility='group'` 발언까지 방 전체 스크린에 원문으로 띄웠다. 그룹 안에서만
 * 공유하기로 하고 쓴 말이 전체에 뜨는 것은 익명성 계약 위반이다.
 *
 * moderation 통과는 **필요조건일 뿐 충분조건이 아니다**: 전체 화면에는
 * 화자가 명시적으로 전체 공개(`public`)를 선택한 발언만 올린다.
 */
export function isRoomVisibleStatement(visibility: StatementVisibility): boolean {
  return visibility === 'public'
}
