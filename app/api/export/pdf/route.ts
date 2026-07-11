import { NextResponse } from 'next/server'
import { sessions } from '@/lib/db/repo'
import { exportSessionPdfBuffer } from '@/lib/export/pdf'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionIdParam = url.searchParams.get('sessionId')
  const ctx = adminContext()
  // sessionId를 지정했으면 그 세션만 — 없으면 오늘 세션으로 잘못 대체하지 않고 404.
  const session = sessionIdParam ? await sessions.findById(ctx, sessionIdParam) : await sessions.getToday(ctx)
  if (!session) return NextResponse.json({ ok: false, error: sessionIdParam ? 'session not found' : 'no session' }, { status: 404 })
  try {
    const buf = await exportSessionPdfBuffer(session.id, session.title)
    const u8 = new Uint8Array(buf)
    // 파일명은 매번 세션 제목 기반(한글 안전 인코딩)
    const safeName = `${session.title} (${String(session.date).slice(0, 10)})`.replace(/[/\\?%*:|"<>\n]+/g, '-').trim()
    return new NextResponse(u8, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.pdf`,
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow'
      }
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'pdf error' }, { status: 500 })
  }
}
