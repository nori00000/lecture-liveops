import { NextResponse } from 'next/server'
import { accessKeys, participants, delibGroups } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
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

  // C-B: 검증된 access_key 로 participant row 를 서버에서 1개 생성(또는 access_key_id 로 조회 재사용).
  // access_key 당 participant 1개(participants_access_key_unique) → 하나의 키로 표를 여러 개 못 던진다.
  // 참가자용 role 만 identity 를 심는다(operator 키로 입장 시에는 participant 신원 불필요).
  let participantId: string | undefined
  let groupId: string | undefined
  if (verified.role === 'participant') {
    const ctx = adminContext(verified.session_id)
    let participant = await participants.findByAccessKeyId(ctx, verified.id)
    if (!participant) {
      try {
        participant = await participants.register(ctx, {
          session_id: verified.session_id,
          display_alias: '',
          anon_handle: '',
          access_key_id: verified.id
        })
      } catch {
        // 동시 입장 레이스에서 unique 충돌 시 방금 생성된 row 재조회.
        participant = await participants.findByAccessKeyId(ctx, verified.id)
      }
    }
    if (!participant) return NextResponse.json({ ok: false, error: 'participant provisioning failed' }, { status: 500 })
    participantId = participant.id
    const membership = await delibGroups.findMembershipByParticipant(ctx, participant.id)
    groupId = membership?.group_id
  }

  const res = NextResponse.json(
    { ok: true, role: verified.role, sessionId: verified.session_id, redirectTo: '/p/dashboard' },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
  res.cookies.set(
    PARTICIPANT_SESSION_COOKIE,
    createParticipantSession(verified, Date.now(), { participantId, groupId }),
    participantCookieOptions()
  )
  return res
}
