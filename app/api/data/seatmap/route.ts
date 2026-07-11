import { NextResponse } from 'next/server'
import { seatLayouts, seatMarks } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/data/seatmap?sessionId=... → { layout: SeatLayout | null, marks: SeatMark[] }
export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })
  }
  const ctx = adminContext(sessionId)
  const [layout, marks] = await Promise.all([
    seatLayouts.getBySession(ctx, sessionId),
    seatMarks.list(ctx, sessionId)
  ])
  return NextResponse.json(
    { ok: true, layout: layout ?? null, marks },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
