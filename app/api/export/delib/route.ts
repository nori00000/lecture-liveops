// 숙의 워크숍 결과 리포트 다운로드 — GET /api/export/delib?sessionId=...&format=md|html|xlsx
// operator 전용: operatorGate.PROTECTED_API_PATHS 에 이 경로를 등록해 미들웨어가 보호한다.
// 개인 투표 원자료는 리포트에 담기지 않는다 — 집계·원 발언·절차 증빙만 (거버넌스 §7-2).
import { NextResponse } from 'next/server'
import { adminContext } from '@/lib/db/neonHelpers'
import { buildWorkshopReport } from '@/lib/delib/report'
import { planDelibMarkdownDocument, planDelibHtmlExport, planDelibXlsxBuffer } from '@/lib/delib/reportFormats'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  const format = (url.searchParams.get('format') ?? 'md').toLowerCase()
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId is required' }, { status: 400 })
  }
  if (format !== 'md' && format !== 'html' && format !== 'xlsx') {
    return NextResponse.json({ ok: false, error: 'format must be md, html, or xlsx' }, { status: 400 })
  }

  const ctx = adminContext(sessionId)
  const report = await buildWorkshopReport(ctx, sessionId)
  if (!report) {
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  const safeName = `${report.overview.title} 결과리포트 (${String(report.overview.date).slice(0, 10)})`
    .replace(/[/\\?%*:|"<>\n]+/g, '-')
    .trim()
  const baseHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } as const

  if (format === 'xlsx') {
    const buf = await planDelibXlsxBuffer(report)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        ...baseHeaders,
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.xlsx`
      }
    })
  }

  if (format === 'html') {
    const html = planDelibHtmlExport(report)
    return new NextResponse(html, {
      status: 200,
      headers: {
        ...baseHeaders,
        'content-type': 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.html`
      }
    })
  }

  // md
  const md = planDelibMarkdownDocument(report)
  return new NextResponse(md, {
    status: 200,
    headers: {
      ...baseHeaders,
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.md`
    }
  })
}
