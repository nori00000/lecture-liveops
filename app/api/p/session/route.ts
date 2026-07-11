import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { PARTICIPANT_SESSION_COOKIE, readParticipantSession } from '@/lib/participantSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const cookieStore = await cookies()
  const session = readParticipantSession(cookieStore.get(PARTICIPANT_SESSION_COOKIE)?.value)
  if (!session) return NextResponse.json({ ok: false }, { status: 401, headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } })
  return NextResponse.json(
    { ok: true, role: session.role, sessionId: session.sessionId },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
