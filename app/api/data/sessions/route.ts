import { NextResponse } from 'next/server'
import { sessions, companies, courses } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const ctx = adminContext()
  const [s, c, cr] = await Promise.all([sessions.list(ctx), companies.list(ctx), courses.list(ctx)])
  return NextResponse.json({ ok: true, sessions: s, companies: c, courses: cr })
}
