import { NextResponse } from 'next/server'
import { query, adminContext } from '@/lib/db/neonHelpers'
import {
  looksLikeStaticSlideDeck,
  parseStaticSlidesHtml,
  type Chapter
} from '@/lib/liveops/timeline-parser'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 상황판 "타임라인 연동" — 기획 타임라인 링크(joonlab 등)를 받아 챕터·시각을 파싱해
// 세션 metadata.plannedTimeline 에 저장한다. 상황판의 "기획 vs 실제 진행" 패널이 이걸 쓴다.

// SSRF 방어: https 공개 호스트만 허용.
function safeUrl(raw: string): URL | null {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'https:') return null
  const h = u.hostname
  if (h === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || h.endsWith('.local')) return null
  return u
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

// -------------------------------------------------------------------------
// Fallback: Joonlab/Vite JS 번들 Parser (기존 로직 보존)
// -------------------------------------------------------------------------

async function fetchText(url: string): Promise<string> {
  return await (
    await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    })
  ).text()
}

async function parseJoonlabViteTimeline(html: string, url: string): Promise<Chapter[]> {
  const scripts = [...html.matchAll(/src="([^"]+\.js[^"]*)"/g)]
    .map((m) => new URL(m[1], url).href)
    .slice(0, 4)

  const re = /\{id:"(ch\d+)",num:"[^"]*",titleKo:"([^"]*)",titleEn:"[^"]*",timeStart:"([^"]*)",timeEnd:"([^"]*)"/g

  for (const s of scripts) {
    let js = ''
    try {
      js = await fetchText(s)
    } catch {
      continue
    }

    const chapters: Chapter[] = []
    for (const m of js.matchAll(re)) {
      const [, id, title, start, end] = m
      if (start && title) {
        chapters.push({
          id,
          title: decodeHtml(title).trim(),
          start,
          end: end || start
        })
      }
    }

    if (chapters.length) return chapters
  }

  return []
}

// -------------------------------------------------------------------------
// Main Entry
// -------------------------------------------------------------------------

async function parseTimeline(url: string): Promise<Chapter[]> {
  const html = await fetchText(url)

  if (looksLikeStaticSlideDeck(html)) {
    const chapters = parseStaticSlidesHtml(html)
    if (chapters.length) return chapters
  }

  return parseJoonlabViteTimeline(html, url)
}

export async function POST(req: Request) {
  let p: { sessionId?: string; url?: string }
  try { p = await req.json() } catch { return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 }) }
  if (!p.sessionId || typeof p.sessionId !== 'string') return NextResponse.json({ ok: false, error: 'sessionId 필요' }, { status: 400 })
  if (!p.url) return NextResponse.json({ ok: false, error: '링크 필요' }, { status: 400 })
  const u = safeUrl(p.url)
  if (!u) return NextResponse.json({ ok: false, error: 'https 공개 링크만 지원합니다' }, { status: 400 })

  const chapters = await parseTimeline(u.href).catch(() => [])
  if (!chapters.length) return NextResponse.json({ ok: false, error: '링크에서 타임라인을 찾지 못했습니다 (지원되는 기획안 링크인지 확인)' }, { status: 422 })

  const planned = { url: u.href, chapters }
  const rows = await query(
    adminContext(p.sessionId),
    `update sessions set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('plannedTimeline', $2::jsonb) where id = $1 returning id`,
    [p.sessionId, JSON.stringify(planned)]
  )
  if (!rows.length) return NextResponse.json({ ok: false, error: '세션 없음' }, { status: 404 })
  return NextResponse.json({ ok: true, plannedTimeline: planned }, { headers: { 'cache-control': 'no-store' } })
}
