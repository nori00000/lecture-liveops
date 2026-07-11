import { NextResponse } from 'next/server'
import { qna, practice, opsLogs, resources, signals, tableStatuses, excel, exportJobs, ledger } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { resolveBoardSession } from '@/lib/liveops/board-session'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionIdParam = url.searchParams.get('sessionId')
  // 클라이언트 서브 페이지(qna/ops/…)는 sessionId 를 안 넘기므로 쿠키에 저장된 분반을 따라간다.
  const session = await resolveBoardSession(sessionIdParam)
  if (!session) return NextResponse.json({ ok: false, error: 'no session' }, { status: 404 })

  const ctx = adminContext(session.id)
  const [qnaRows, ptRows, opsRows, rsRows, sigRows, tsRows, exTpls, exJobs, ledRows] = await Promise.all([
    qna.list(ctx, session.id),
    practice.list(ctx, session.id),
    opsLogs.list(ctx, session.id),
    resources.list(ctx, session.id),
    signals.list(ctx, session.id),
    tableStatuses.list(ctx, session.id),
    excel.listTemplates(ctx, session.id),
    exportJobs.list(ctx, session.id),
    ledger.list(ctx, 20)
  ])

  return NextResponse.json(
    {
      ok: true,
      session,
      qna: qnaRows,
      practice: ptRows,
      ops: opsRows,
      resources: rsRows,
      signals: sigRows,
      table_statuses: tsRows,
      excel_templates: exTpls,
      export_jobs: exJobs,
      ledger_recent: ledRows
    },
    { headers: { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } }
  )
}
