// 시각 표시는 항상 KST 기준 — Vercel 서버 TZ(UTC)와 무관하게 SSR/클라이언트 동일 출력.
export function formatTimeKo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul'
  })
}

// 오늘 날짜(YYYY-MM-DD)를 KST 기준으로 반환 — toISOString()은 UTC라 한국 오전(00~09시)에 전날이 된다.
export function todayKo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
}
