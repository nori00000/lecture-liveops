// 녹음·전사 상시 배너 (transcript-architecture §4).
// recordingConsent=true 인 세션에서 참가자 화면·콘솔에 항상 노출된다 — 숨기거나 접을 수 없다.
// 원음성은 현장 박스를 떠나지 않으며, 저장되는 것은 테이블 단위 전사 텍스트뿐이라는 사실을 함께 고지한다.
export function RecordingBanner({ active, audience }: { active: boolean; audience: 'participant' | 'operator' }) {
  if (!active) return null
  return (
    <div
      role="status"
      className="mb-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger flex items-start gap-2"
    >
      <span aria-hidden="true">●</span>
      <span>
        <strong>이 세션은 녹음 중입니다.</strong>{' '}
        {audience === 'participant'
          ? '테이블 단위 음성이 텍스트로 전사되며, 발언자 개인은 식별하지 않습니다. 녹음을 원하지 않으면 진행자에게 알려주세요 — 해당 테이블은 녹음하지 않거나 녹음 구역 밖 좌석으로 안내합니다.'
          : '참가자에게 녹음·전사 고지와 동의 절차를 마쳤는지 확인하세요. 미동의 참가자가 있으면 해당 테이블은 녹음하지 않습니다.'}
      </span>
    </div>
  )
}
