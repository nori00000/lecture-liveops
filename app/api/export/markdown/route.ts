import { NextResponse } from 'next/server'
import { planMarkdownExport } from '@/lib/export/markdown'
import { sessions } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 })
  }

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  const files = await planMarkdownExport(ctx, sessionId)
  return NextResponse.json(
    {
      ok: true,
      session: { id: session.id, title: session.title, date: session.date, mode: session.mode },
      files
    },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
