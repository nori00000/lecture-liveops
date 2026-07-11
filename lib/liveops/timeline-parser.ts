export type Chapter = { id: string; title: string; start: string; end: string }

type StaticSlide = {
  index: number
  label: string
  html: string
  text: string
  times: string[]
  titleCandidates: string[]
  chapterNo: number | null
  isCover: boolean
}

type TimelineAnchor = {
  slide: StaticSlide
  kind: 'cover' | 'time'
  chapterNo: number | null
  title: string
  start: string | null
  end: string | null
}

export function looksLikeStaticSlideDeck(html: string): boolean {
  return (
    /<deck-stage\b/i.test(html) ||
    /<section\b[^>]*\bdata-label\s*=/i.test(html) ||
    /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b/i.test(html)
  )
}

function readAttr(attrs: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
  const m = attrs.match(re)
  return decodeHtml((m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim())
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

function htmlToText(htmlContent: string): string {
  return decodeHtml(
    htmlContent
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h1|h2|h3|li)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s+/g, '\n')
      .trim()
  )
}

function extractTimes(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g)) {
    const hh = m[1].padStart(2, '0')
    const mm = m[2]
    const t = `${hh}:${mm}`
    if (!out.includes(t)) out.push(t)
  }
  return out
}

function extractChapterNo(text: string): number | null {
  const m = text.match(/\b(?:ch\.?|chapter)\s*0?(\d+)\b/i)
  return m ? Number(m[1]) : null
}

function isChapterCover(label: string, text: string, chapterNo: number | null): boolean {
  if (chapterNo !== null) return true
  return (
    /\bcover\b/i.test(label) ||
    /\b(?:ch\.?|chapter)\s*\d+\b/i.test(label) ||
    /^\s*(?:ch\.?|chapter)\s*\d+\b/i.test(text)
  )
}

function cleanLabelTitle(label: string): string {
  return label
    .replace(/^\s*\d+\s+/, '')
    .replace(/\b(?:ch\.?|chapter)\s*\d+\s*cover\b/i, '')
    .replace(/\bcover\b/i, '')
    .trim()
}

function pushCleanCandidate(out: string[], raw: string) {
  const s = raw
    .replace(/\s+/g, ' ')
    .replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/g, '')
    .trim()

  if (!s) return
  if (/^\d+$/.test(s)) return
  if (/^(?:ch\.?|chapter)\s*\d+$/i.test(s)) return
  if (!out.includes(s)) out.push(s)
}

function extractTitleCandidates(sectionHtml: string, label: string, text: string): string[] {
  const candidates: string[] = []

  const classRe = /<([a-z][\w:-]*)\b[^>]*\bclass\s*=\s*["'][^"']*(?:chap-label|section-tag|kicker|mono|time)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi
  for (const m of sectionHtml.matchAll(classRe)) {
    pushCleanCandidate(candidates, htmlToText(m[2] ?? ''))
  }

  const headingRe = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/gi
  for (const m of sectionHtml.matchAll(headingRe)) {
    pushCleanCandidate(candidates, htmlToText(m[1] ?? ''))
  }

  pushCleanCandidate(candidates, cleanLabelTitle(label))

  for (const line of text.split(/\n+/).slice(0, 5)) {
    pushCleanCandidate(candidates, line)
  }

  return candidates
}

function extractSlides(html: string): StaticSlide[] {
  const slides: StaticSlide[] = []
  const sectionRe = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi

  let match: RegExpExecArray | null
  while ((match = sectionRe.exec(html))) {
    const attrs = match[1] ?? ''
    const body = match[2] ?? ''
    const className = readAttr(attrs, 'class')
    const label = readAttr(attrs, 'data-label')

    if (!label && !/\bslide\b/i.test(className)) continue

    const text = htmlToText(body)
    const times = extractTimes(text)
    const chapterNo = extractChapterNo(`${label} ${text}`)
    const isCover = isChapterCover(label, text, chapterNo)
    const titleCandidates = extractTitleCandidates(body, label, text)

    slides.push({
      index: slides.length,
      label,
      html: body,
      text,
      times,
      titleCandidates,
      chapterNo,
      isCover
    })
  }

  return slides
}

function pickBestTitle(slide: StaticSlide): string {
  const preferred = slide.titleCandidates.find((t) => {
    if (/^(?:ch\.?|chapter)\s*\d+/i.test(t)) return false
    if (/^\d+\s/.test(t)) return false
    return t.length >= 2
  })
  if (preferred) return preferred

  if (slide.chapterNo) return `Chapter ${slide.chapterNo}`
  return cleanLabelTitle(slide.label)
}

function anchorFromSlide(slide: StaticSlide, kind: 'cover' | 'time'): TimelineAnchor {
  const title = pickBestTitle(slide) || (slide.chapterNo ? `Chapter ${slide.chapterNo}` : `Milestone ${slide.index + 1}`)
  return {
    slide,
    kind,
    chapterNo: slide.chapterNo,
    title,
    start: slide.times[0] ?? null,
    end: slide.times[1] ?? null
  }
}

function dedupeAnchors(anchors: TimelineAnchor[]): TimelineAnchor[] {
  const out: TimelineAnchor[] = []
  const sorted = [...anchors].sort((a, b) => {
    if (a.kind === b.kind) return a.slide.index - b.slide.index
    return a.kind === 'cover' ? -1 : 1
  })

  for (const a of sorted) {
    const dup = out.some((b) => {
      if (b.slide.index === a.slide.index) return true
      if (a.start && b.start === a.start) return true
      return false
    })
    if (!dup) out.push(a)
  }
  return out.sort((a, b) => a.slide.index - b.slide.index)
}

function inferAnchorTimes(anchors: TimelineAnchor[], slides: StaticSlide[]): TimelineAnchor[] {
  return anchors.map((anchor) => {
    if (anchor.start) return anchor

    const grouped = slides.slice(anchor.slide.index)
    const firstTimed = grouped.find((s) => s.times.length > 0)

    return {
      ...anchor,
      start: firstTimed?.times[0] ?? null,
      end: firstTimed?.times[1] ?? anchor.end
    }
  })
}

function hasMeaningfulMilestoneTitle(slide: StaticSlide): boolean {
  const title = cleanLabelTitle(slide.label)
  if (!title) return false
  const lower = title.toLowerCase()
  if (lower === 'title' || lower === 'closing' || lower === 'hands-on' || lower === 'agenda') return false
  return true
}

export function parseStaticSlidesHtml(html: string): Chapter[] {
  const slides = extractSlides(html)
  if (!slides.length) return []

  const covers = slides.filter((s) => s.isCover)
  const timed = slides.filter((s) => s.times.length > 0)

  const anchors: TimelineAnchor[] = []

  for (const cover of covers) {
    anchors.push(anchorFromSlide(cover, 'cover'))
  }

  for (const slide of timed) {
    const alreadyCover = anchors.some((a) => a.slide.index === slide.index)
    if (!alreadyCover && hasMeaningfulMilestoneTitle(slide)) {
      anchors.push(anchorFromSlide(slide, 'time'))
    }
  }

  anchors.sort((a, b) => a.slide.index - b.slide.index)

  const enriched = inferAnchorTimes(anchors, slides)
  const deduped = dedupeAnchors(enriched)

  return deduped
    .filter((a) => a.start)
    .map((a, i, arr) => ({
      id: `ch${String(i + 1).padStart(2, '0')}`,
      title: a.title || `Chapter ${i + 1}`,
      start: a.start!,
      end: a.end || arr[i + 1]?.start || a.start!
    }))
}
