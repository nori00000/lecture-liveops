import { NextResponse } from 'next/server'
import { excel } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const templateId = url.searchParams.get('templateId')
  if (!templateId) return NextResponse.json({ ok: false, error: 'templateId required' }, { status: 400 })
  const ctx = adminContext()
  const tpl = await excel.getTemplate(ctx, templateId)
  if (!tpl) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 })
  const ctxWithSession = adminContext(tpl.session_id)
  const cells = await excel.listCells(ctxWithSession, tpl.id)
  return NextResponse.json({ ok: true, template: tpl, cells })
}
