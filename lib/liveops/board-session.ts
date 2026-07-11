import { cookies } from 'next/headers'
import { sessions } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { BOARD_COOKIE } from './board-cookie'

// 분반(세션) 해석 우선순위: 명시 id(공유 링크) → 쿠키(같은 교육 범위) → getToday 기본.
// 쿠키는 getToday 활성 세션과 같은 날짜+기업일 때만 유지 → 교육일이 바뀌면 자동 무효화(과거 분반 고착 방지).
// ponytail: 상태를 쿠키에 두는 이유 = nav 링크가 ?sessionId 를 안 물고 가서 URL만으로는 새로고침 시 소실됨.
export async function resolveBoardSession(explicitId?: string | null) {
  if (explicitId) {
    const s = await sessions.findById(adminContext(explicitId), explicitId)
    if (s) return s
  }
  const fallback = await sessions.getToday(adminContext())
  const cookieId = (await cookies()).get(BOARD_COOKIE)?.value
  if (cookieId && fallback && cookieId !== fallback.id) {
    const s = await sessions.findById(adminContext(cookieId), cookieId)
    if (s && s.date === fallback.date && s.company_id === fallback.company_id) return s
  }
  return fallback
}
