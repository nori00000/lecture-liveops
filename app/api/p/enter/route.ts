import { NextResponse } from 'next/server'
import { accessKeys } from '@/lib/db/repo'
import { createParticipantSession, participantCookieOptions, PARTICIPANT_SESSION_COOKIE } from '@/lib/participantSession'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  let body: { accessKey?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  const rawKey = typeof body.accessKey === 'string' ? body.accessKey.trim() : ''
  if (!rawKey) return NextResponse.json({ ok: false, error: 'access key required' }, { status: 400 })

  const verified = await accessKeys.verify(rawKey)
  if (!verified) return NextResponse.json({ ok: false, error: 'invalid access key' }, { status: 403 })

  const res = NextResponse.json(
    { ok: true, role: verified.role, sessionId: verified.session_id, redirectTo: '/p/dashboard' },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
  res.cookies.set(PARTICIPANT_SESSION_COOKIE, createParticipantSession(verified), participantCookieOptions())
  return res
}
