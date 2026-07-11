// 세션 아카이브 HTML 생성·다운로드 (선택적 LLM 보조 기반, 실패 시 결정론 fallback).
// GET /api/export/html?sessionId=... → text/html attachment.
import { generateSessionHtml, generateCombinedHtml } from '@/lib/export/html'
import { adminContext } from '@/lib/db/neonHelpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  const sessionIdsParam = url.searchParams.get('sessionIds') // 목·금 등 다중 세션 통합
  const title = url.searchParams.get('title') ?? undefined
  let result
  if (sessionIdsParam) {
    const ids = sessionIdsParam.split(',').map((s) => s.trim()).filter(Boolean)
    result = ids.length ? await generateCombinedHtml(ids, title) : null
  } else if (sessionId) {
    result = await generateSessionHtml(adminContext(sessionId), sessionId)
  } else {
    return new Response('sessionId or sessionIds is required', { status: 400 })
  }
  if (!result) {
    return new Response('session not found', { status: 404 })
  }
  const safeName = result.title.replace(/[/\\?%*:|"<>\n]+/g, '-').trim()
  return new Response(result.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}.html`,
      'x-export-engine': result.engine,
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow'
    }
  })
}
