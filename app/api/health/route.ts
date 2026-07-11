import { NextResponse } from 'next/server'
import { getMode } from '@/lib/db/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: getMode(),
    timestamp: new Date().toISOString(),
    service: 'ax-liveops'
  })
}
