// 숙의 워크숍 결과 리포트 다운로드 — GET /api/export/delib?sessionId=...&format=md|html|xlsx
// operator 전용: operatorGate.PROTECTED_API_PATHS 에 이 경로를 등록해 미들웨어가 보호한다.
// 개인 투표 원자료는 리포트에 담기지 않는다 — 집계·원 발언·절차 증빙만 (거버넌스 §7-2).
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { adminContext } from '@/lib/db/neonHelpers'
import { ledger } from '@/lib/db/repo'
import { hashInput } from '@/lib/action/redact'
import { OPERATOR_COOKIE, isOperatorGateEnabled, verifyOperatorCookie } from '@/lib/security/operatorGate'
import { buildWorkshopReport } from '@/lib/delib/report'
import { planDelibMarkdownDocument, planDelibHtmlExport, planDelibXlsxBuffer } from '@/lib/delib/reportFormats'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// F2: 가장 민감한 export 이므로 미들웨어 게이트 누락 대비 라우트 내부에서 operator 쿠키를 2차 검증한다.
//     또한 세션 존재 확인(404) 후 다운로드를 action_ledger 에 기록해 무추적 export 를 막는다.
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

  // (a) operator 쿠키 2차 방어 — 게이트 활성 시 유효한 operator 세션 없으면 거부.
  if (isOperatorGateEnabled()) {
    const cookieStore = await cookies()
    if (!verifyOperatorCookie(cookieStore.get(OPERATOR_COOKIE)?.value)) {
      return NextResponse.json({ ok: false, error: 'operator key required' }, { status: 401 })
    }
  }

  const ctx = adminContext(sessionId)
  const report = await buildWorkshopReport(ctx, sessionId)
  if (!report) {
    // (c) 세션 없음 → 404 (임의 sessionId 로 타 세션 리포트 생성 차단).
    return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })
  }

  // (b) 다운로드를 action_ledger 에 기록 (actor_role·sessionId·format·time). ledger 충돌은 무시하고 export 는 진행.
  try {
    await ledger.insert(ctx, {
      session_id: sessionId,
      actor_type: 'human',
      actor_role: 'instructor',
      tool: 'web-ui',
      action_name: 'delib.export_report',
      input_hash: hashInput(`${sessionId}:${format}`),
      input_redacted_summary: `format=${format}`,
      output_summary: `delib report exported (${format})`,
      status: 'ok'
    })
  } catch {
    // ledger insert 실패(unique 충돌 등)는 export 를 막지 않는다.
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
