import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// CSP report-uri target. 본문에는 violated-directive, blocked-uri 등이 들어있다.
// P1-6 (observability) 도입 후 Sentry 등으로 전송. 지금은 stderr 로깅.
export async function POST(req: Request) {
  try {
    const body = await req.text()
    // 본문이 너무 길면 잘라서 로깅 (1KB)
    const trimmed = body.length > 1024 ? body.slice(0, 1024) + '…' : body
    console.error('[csp-report]', trimmed)
  } catch {
    // ignore
  }
  return new NextResponse(null, { status: 204 })
}

// 일부 브라우저는 OPTIONS preflight를 보낸다.
export async function OPTIONS() {
  return new NextResponse(null, { status: 204 })
}
