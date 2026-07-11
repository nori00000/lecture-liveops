// 세션 아카이브 → 단일 HTML 관찰일지 (레퍼런스 디자인 정본 이식).
//  - 구조/폰트/CSS: nontechnical-korean SSoT (따뜻한 종이 × 에디토리얼, AtoZ 단일 보이스 + Pretendard
//    fallback, 테라코타 단일 강조). 관찰 데이터에서 결정론으로 생성 → 레퍼런스와 폰트·구조 일치.
//  - 회고 인사이트: 연결된 OpenAI 호환 LLM이 데이터에서 합성(JSON). 실패/지연 시 결정론 fallback.
//  - generateSessionHtml: 다운로드 버튼용 (engine이 fallback이 아니면 인사이트를 LLM이 작성).
//  - exportSessionHtml:   pdf.tsx PDF 폴백용 (LLM 미사용, 결정론 인사이트).
// 보안: API 키/응답 원문을 로그에 출력하지 않는다.

import { sessions, observations, materialVersions, opsLogs, qna } from '@/lib/db/repo'
import { adminContext, type RlsContext } from '../db/neonHelpers'
import { nowIso } from '@/lib/util/id'
import { formatTimeKo, todayKo } from '@/lib/util/koreanTime'
import { buildSessionDashboard } from '@/lib/liveops/dashboard'
import type { SituationSnapshot, StructuredObservation, LectureSessionMeta } from '@/lib/liveops/types'
import type { Session } from '@/lib/db/schema'

const HTML_TIMEOUT_MS = 50_000
const RACE_TIMEOUT_MS = 54_000

export type HtmlExport = { html: string; engine: string; title: string }

type Insight = { h: string; p: string }
type Bottleneck = { biggest: string; clusters: Insight[]; next: string[] }
type Analysis = { insights: Insight[]; bottleneck: Bottleneck }

type QnaLite = { body: string; answer: string | null; created_at: string }
type Report = {
  session: Session
  meta: LectureSessionMeta
  snapshot: SituationSnapshot
  obs: StructuredObservation[] // 시간 오름차순
  qna: QnaLite[] // Q&A 칸반(qna_items) — 관찰과 별개 저장이라 명시적으로 포함
  title: string
  retroNote?: string // 운영자 현장 회고 — 병목 판단 최우선 기준(있으면)
}

// ── 데이터 수집 ───────────────────────────────────────────────
async function buildReport(ctx: RlsContext, sessionId: string): Promise<Report | null> {
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return null
  const [obs, mats, ops, qnaRows] = await Promise.all([
    observations.listBySession(sessionId),
    materialVersions.listBySession(sessionId),
    opsLogs.list(ctx, sessionId),
    qna.list(ctx, sessionId)
  ])
  const rawNotes = ops.map((o) => ({
    id: o.id,
    session_id: o.session_id,
    raw_text: o.body,
    author_role: o.created_by_role,
    source: 'web' as const,
    created_at: o.created_at
  }))
  const dash = buildSessionDashboard({ session, rawNotes, observations: obs, materials: mats, now: nowIso() })
  const asc = [...dash.observations].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const retro = (session.metadata as { retroNote?: unknown }).retroNote
  const retroNote = typeof retro === 'string' && retro.trim() ? retro.trim() : undefined
  const qnaLite = qnaRows.map((q) => ({ body: q.body, answer: q.answer, created_at: q.created_at }))
  return { session, meta: dash.meta, snapshot: dash.snapshot, obs: asc, qna: qnaLite, title: `${session.title} (${session.date})`, retroNote }
}

// ── 분류(표시 카테고리) 매핑 ──────────────────────────────────
type Disp = { key: 'issue' | 'q' | 'lab' | 'flow'; label: string }
function dispOf(cat: StructuredObservation['category']): Disp {
  if (cat === 'error' || cat === 'cause' || cat === 'solution') return { key: 'issue', label: '오류·해결' }
  if (cat === 'question' || cat === 'answer') return { key: 'q', label: '질문' }
  if (cat === 'progress') return { key: 'lab', label: '실습·진행' }
  return { key: 'flow', label: '운영·흐름' }
}

function timeOf(o: StructuredObservation): string {
  const tl = o.time_label?.trim()
  if (tl && /^\d{1,2}:\d{2}$/.test(tl)) {
    const [h, m] = tl.split(':')
    return `${h.padStart(2, '0')}:${m}`
  }
  return formatTimeKo(o.created_at)
}

function counts(obs: StructuredObservation[]) {
  const c = { issue: 0, q: 0, lab: 0, flow: 0 }
  for (const o of obs) c[dispOf(o.category).key] += 1
  return c
}

// image_data 파싱 — 다중은 JSON 배열, 단일(레거시)은 'data:...' 문자열. 둘 다 string[]로.
function parseImages(v?: string): string[] {
  if (!v) return []
  if (v.startsWith('[')) {
    try {
      const a: unknown = JSON.parse(v)
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return [v]
}

function imageCount(obs: StructuredObservation[]): number {
  return obs.reduce((n, o) => n + parseImages(o.image_data).length, 0)
}

// ── LLM 분석(회고 인사이트 + 병목 분석, 단일 호출) ────────────────
function llmEngineName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('gpt-5.5')) return 'gpt-5.5'
  return 'llm'
}

async function tryLlmAnalysis(report: Report): Promise<{ analysis: Analysis; engine: string } | null> {
  const baseUrl = process.env.LIVEOPS_LLM_BASE_URL
  const apiKey = process.env.LIVEOPS_LLM_API_KEY
  const model = process.env.LIVEOPS_LLM_MODEL ?? 'local-model'
  if (!baseUrl || !apiKey) return null

  const digest = report.obs
    .map((o) => `[${timeOf(o)}] (${dispOf(o.category).label}) ${o.summary}`)
    .join('\n')
    .slice(0, 6500)
  const system = [
    '너는 기업 AI 교육 현장 관찰 기록을 분석하는 시니어 에디터다.',
    '하루치 관찰 로그를 읽고 JSON 객체 하나로 두 가지를 출력한다.',
    '1) insights: 회고 인사이트 5~7개. 각 {"h":제목(한 줄,명사형),"p":설명(2~3문장)}.',
    '2) bottleneck: 병목 분석.',
    '   {"biggest": 오늘 가장 큰 병목을 한 문장으로,',
    '    "clusters": 병목 군집 3~4개 [{"h":병목명,"p":근거·빈도·영향 2~3문장}],',
    '    "next": 다음 교육 개선안 4~6개 [문자열]}',
    '데이터에 실제로 나타난 패턴만. 지어내기 금지. 이모지·과장 형용사·AI 슬롭 금지. 평서체 -다체.',
    '운영자 현장 회고가 주어지면 그것을 병목 판단의 최우선 기준으로 삼고(로그는 보조 근거), 회고와 어긋나는 결론을 내지 마라.',
    '특히 환경·서버·보안·PC·인코딩처럼 강사 통제 밖 요인은 "시스템 문제"로, 가이드·진행은 "운영 문제"로 구분해 과도하게 운영/교육 탓으로 몰지 마라.',
    '출력은 JSON 객체 하나만: {"insights":[...],"bottleneck":{...}}. 다른 텍스트·코드펜스 금지.'
  ].join('\n')
  const retroBlock = report.retroNote ? `【운영자 현장 회고 — 최우선 기준】\n${report.retroNote}\n\n` : ''
  const user = `세션: ${report.title}\n\n${retroBlock}관찰 로그(시간순):\n${digest}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTML_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 3200,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      console.error(`[export-html] llm http error status=${res.status}`)
      return null
    }
    const body: unknown = await res.json().catch(() => null)
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return null
    const analysis = parseAnalysis(content)
    return analysis ? { analysis, engine: llmEngineName(model) } : null
  } catch (e: unknown) {
    console.error(`[export-html] llm request failed (${e instanceof Error ? e.name : 'unknown'})`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

function cleanInsights(arr: unknown): Insight[] {
  if (!Array.isArray(arr)) return []
  const out: Insight[] = []
  for (const it of arr) {
    const h = typeof (it as Insight)?.h === 'string' ? (it as Insight).h.trim() : ''
    const p = typeof (it as Insight)?.p === 'string' ? (it as Insight).p.trim() : ''
    if (h && p) out.push({ h, p })
  }
  return out.slice(0, 8)
}

function parseAnalysis(text: string): Analysis | null {
  const begin = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (begin < 0 || end <= begin) return null
  let obj: unknown
  try {
    obj = JSON.parse(text.slice(begin, end + 1))
  } catch {
    return null
  }
  const o = obj as { insights?: unknown; bottleneck?: unknown }
  const insights = cleanInsights(o.insights)
  const bn = o.bottleneck as { biggest?: unknown; clusters?: unknown; next?: unknown } | undefined
  const biggest = typeof bn?.biggest === 'string' ? bn.biggest.trim() : ''
  const clusters = cleanInsights(bn?.clusters)
  const next = Array.isArray(bn?.next)
    ? (bn.next.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 6))
    : []
  if (!insights.length && !biggest) return null
  return { insights, bottleneck: { biggest, clusters, next } }
}

// 결정론 fallback 인사이트 — 스냅샷·집계에서 도출.
function deterministicInsights(report: Report): Insight[] {
  const c = counts(report.obs)
  const out: Insight[] = []
  if (c.issue > 0) out.push({ h: `오류·해결 신호 ${c.issue}건`, p: `현장에서 막힘·오류 신호가 ${c.issue}건 기록되었다. ${report.snapshot.blocker_summary}` })
  if (report.snapshot.question_load !== 'low') out.push({ h: '질문이 누적된 구간', p: `현장 Q&A가 ${c.q}건으로 ${report.snapshot.question_load === 'high' ? '많이' : '일부'} 쌓였다. 반복 질문을 묶어 공통 답변 시간을 두는 편이 좋다.` })
  if (c.lab > 0) out.push({ h: `실습·진행 ${c.lab}건`, p: `도구·실습 진행 관련 기록이 ${c.lab}건으로 하루의 중심 흐름을 이뤘다.` })
  out.push({ h: '종합 상황', p: report.snapshot.ai_summary })
  return out.slice(0, 6)
}

// 결정론 fallback 병목 분석 — 이슈 항목 키워드 군집 + 표준 개선안.
function deterministicBottleneck(report: Report): Bottleneck {
  const issues = report.obs.filter((o) => dispOf(o.category).key === 'issue' || o.issue)
  const groups: { name: string; re: RegExp; note: string }[] = [
    { name: '실습 환경·개인 PC', re: /개인\s*pc|회사\s*pc|대여\s*pc|노트북|로컬\s*호스트|압축|드라이브|충전/i, note: '개인/회사 PC 분기와 환경 차이에서 오류가 반복됐고 대체로 PC 교체로 우회했다.' },
    { name: '도구 불안정(Gemini·GEMs·Canvas)', re: /gemini|gems|canvas|pro 모델|flash|서버|api/i, note: 'Gemini Canvas·GEMs·Pro 모델·서버 API가 간헐적으로 실패해 모델 다운그레이드·새 채팅으로 우회했다.' },
    { name: '사내 보안 정책', re: /보안|인증|팝업|차단|사내망|사외망|방화벽|쿼터/i, note: '보안 팝업·접근 제한·쿼터로 진행이 막혀 PC 교체·우회가 필요했다.' },
    { name: '인코딩·이미지 URL', re: /인코딩|url|이미지|마크다운|윈도우/i, note: '이미지 URL 인코딩과 윈도우 표준 인코딩 문제로 결과 확인이 지연됐다.' },
    { name: '시간·진행 지연', re: /시간|지연|오래|속도|범위/i, note: '오래 걸리는 태스크로 오후 실습 범위와 시간 배분에 부담이 있었다.' }
  ]
  const scored = groups
    .map((g) => ({ g, n: issues.filter((o) => g.re.test(`${o.summary} ${o.issue ?? ''} ${o.solution ?? ''}`)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
  const clusters = scored.slice(0, 4).map(({ g, n }) => ({ h: `${g.name} (${n}건)`, p: g.note }))
  const biggest = report.retroNote
    ? '시스템(인프라) 문제가 가장 큰 병목이었다 — 서버·보안·PC 환경·인코딩 등 강사 통제 밖 요인. 운영·UX 마찰(실습 폴더 초기 다운로드·적용 시간, 패들렛 버튼 찾기)은 상대적으로 작았다.'
    : scored.length
      ? `${scored[0].g.name} — 관련 이슈가 ${scored[0].n}건으로 가장 빈번했고, 대부분 환경·도구 교체로 우회했다.`
      : '뚜렷한 병목 신호는 적었다.'
  const next = [
    '회사 PC를 기본으로 하고, 개인 PC는 사전 체크리스트(드라이브 접근·압축 프로그램·보안 팝업) 통과자만 허용한다.',
    'Gemini는 안정적인 3.5 Flash를 실습 기본값으로 안내하고 Pro는 선택지로 둔다.',
    '사내 보안 정책(파일 업로드·URL 접근·쿼터)을 IT와 사전 조율하고 예비 회선·예비 PC를 확보한다.',
    '도구 폴백 치트시트(Canvas 먹통→새 채팅, GEMs 에러→일반 채팅, API 불안정→NotebookLM)를 강사·보조강사가 공유한다.',
    '오래 걸리는 태스크는 시간 상한과 중단·재개 가이드를 두고 실습 범위를 우선순위화한다.'
  ]
  return { biggest, clusters, next }
}

// ── 렌더러 ────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const RISK_KO: Record<SituationSnapshot['risk_level'], string> = { green: 'green', yellow: 'yellow', red: 'red' }
const LOAD_KO: Record<SituationSnapshot['question_load'], string> = { low: '낮음', medium: '보통', high: '많음' }
const SPEED_KO: Record<SituationSnapshot['lecture_speed'], string> = { slow: '느림', normal: '보통', fast: '빠름' }

function renderHero(r: Report): string {
  const c = counts(r.obs)
  const first = r.obs[0] ? timeOf(r.obs[0]) : '—'
  const last = r.obs.length ? timeOf(r.obs[r.obs.length - 1]) : '—'
  const company = r.meta.companyName ?? ''
  // 제목은 매번 세션 제목 기반 — 모든 세션이 '기업강의'는 아니므로 고정 라벨을 쓰지 않는다.
  const eyebrow = [company, '현장 관찰 기록'].filter(Boolean).join(' · ')
  return `<section class="wrap hero">
  <span class="hero__eyebrow r r--d1">${esc(eyebrow)}</span>
  <h1 class="hero__title r r--d2">${esc(r.session.title)}<br><span class="soft">관찰일지</span></h1>
  <p class="hero__lead r r--d3">${esc(r.session.title)} 현장을 ${esc(first)}부터 ${esc(last)}까지 관찰한 기록입니다. 운영 타임라인·이슈·Q&amp;A·실습 흐름을 시간순으로 정리했습니다.</p>
  <div class="hero__stats r r--d4">
    <div class="hero__stat hero__stat--accent"><span class="hero__stat-n">${r.obs.length}<span class="unit">건</span></span><span class="hero__stat-l">전체 관찰 기록</span></div>
    <div class="hero__stat"><span class="hero__stat-n">${esc(first)}<span class="unit">–${esc(last)}</span></span><span class="hero__stat-l">시간 범위 (KST)</span></div>
    <div class="hero__stat"><span class="hero__stat-n">${c.issue}<span class="unit">건</span></span><span class="hero__stat-l">오류·해결 신호</span></div>
    <div class="hero__stat"><span class="hero__stat-n">${c.lab}<span class="unit">건</span></span><span class="hero__stat-l">실습·진행</span></div>
  </div>
  <div class="hero__rule r r--d5"></div>
</section>`
}

function renderToc(hasShots: boolean): string {
  const items = [
    ['01', '#sec-overview', '개요'],
    ['02', '#sec-snapshot', '현재 상황 스냅샷'],
    ['03', '#sec-timeline', '전체 운영 타임라인'],
    ['04', '#sec-issues', '발생한 이슈와 해결'],
    ['05', '#sec-qa', '현장 Q&amp;A'],
    ['06', '#sec-flow', '실습·진행 흐름'],
    ['07', '#sec-insights', '회고 인사이트'],
    ['08', '#sec-bottleneck', '병목 분석']
  ]
  if (hasShots) items.push(['09', '#sec-shots', '스크린샷 기록'])
  items.push([hasShots ? '10' : '09', '#sec-source', '데이터 출처'])
  return `<nav class="wrap toc" aria-label="목차">
  <p class="toc__label">목차</p>
  <div class="toc__list">
    ${items.map(([no, href, ko]) => `<a class="toc__item" href="${href}"><span class="toc__no">${no}</span><span class="toc__ko">${ko}</span></a>`).join('\n    ')}
  </div>
</nav>`
}

function sectionHead(no: string, title: string, sub: string): string {
  return `<div class="section__head"><span class="section__no">${no}</span><h2 class="section__title">${title}</h2><p class="section__sub">${esc(sub)}</p></div>`
}

function kvRow(k: string, v: string): string {
  return `<div class="kv__row"><div class="kv__k">${esc(k)}</div><div class="kv__v">${v}</div></div>`
}

function renderOverview(r: Report): string {
  const c = counts(r.obs)
  const rows = [
    kvRow('기업', esc(r.meta.companyName ?? '—')),
    kvRow('교육명', esc(r.meta.category ?? '—')),
    kvRow('일자', esc(r.session.date)),
    kvRow('장소', esc(r.session.venue || '—')),
    kvRow('세션 ID', `<code>${esc(r.session.id)}</code>`),
    kvRow('관찰 기록', `총 ${r.obs.length}건`),
    kvRow('분류', `오류·해결 ${c.issue} · 질문 ${c.q} · 실습·진행 ${c.lab} · 운영·흐름 ${c.flow}`),
    r.meta.mainInstructor ? kvRow('메인 강사', esc(r.meta.mainInstructor)) : '',
    kvRow('시간 범위', `${r.obs[0] ? esc(timeOf(r.obs[0])) : '—'} ~ ${r.obs.length ? esc(timeOf(r.obs[r.obs.length - 1])) : '—'} KST`)
  ].filter(Boolean)
  return `<section class="wrap section" id="sec-overview">${sectionHead('01', '개요', '세션 메타데이터')}<div class="kv"><div class="kv__grid">${rows.join('')}</div></div></section>`
}

function renderSnapshot(r: Report): string {
  const s = r.snapshot
  const rows = [
    kvRow('종합', esc(s.ai_summary)),
    kvRow('위험도', `<span class="risk">risk ${RISK_KO[s.risk_level]}</span>`),
    kvRow('질문', LOAD_KO[s.question_load]),
    kvRow('속도', SPEED_KO[s.lecture_speed]),
    kvRow('막힘/오류', esc(s.blocker_summary)),
    kvRow('분위기', esc(s.mood_summary)),
    kvRow('공유 자료', esc(s.material_summary))
  ].join('')
  const advice = [
    ...s.suggested_main_instructor_actions.map((a) => `<li><strong>메인 강사</strong> — ${esc(a)}</li>`),
    ...s.suggested_assistant_actions.map((a) => `<li><strong>보조 강사</strong> — ${esc(a)}</li>`)
  ].join('')
  const adviceBlock = advice
    ? `<div class="advice"><p class="advice__label">AI 운영 권고</p><ul class="advice__list">${advice}</ul></div>`
    : ''
  return `<section class="wrap section" id="sec-snapshot">${sectionHead('02', '현재 상황 스냅샷', '세션 종료 시점 상황판 기준')}<div class="kv"><div class="kv__grid">${rows}</div></div>${adviceBlock}</section>`
}

function logRows(obs: StructuredObservation[]): string {
  if (!obs.length) return `<div class="log__row"><span class="log__time">—</span><span class="log__cat log__cat--flow"><span class="dot"></span>기록</span><div class="log__body"><p class="log__text">기록 없음</p></div></div>`
  return obs
    .map((o) => {
      const d = dispOf(o.category)
      const tag = o.resolved ? ' <strong>· 해결완료</strong>' : ''
      const shotMark = parseImages(o.image_data).length ? ' <span class="log__shot">📎 스크린샷</span>' : ''
      return `<div class="log__row"><span class="log__time">${esc(timeOf(o))}</span><span class="log__cat log__cat--${d.key}"><span class="dot"></span>${d.label}</span><div class="log__body"><p class="log__text">${esc(o.summary)}${tag}${shotMark}</p></div></div>`
    })
    .join('')
}

// 첨부 이미지를 시각·맥락 캡션과 함께 별도 갤러리로 정리한다(공유 친화, 중복 없음).
function renderShots(r: Report): string {
  const items = r.obs.flatMap((o) =>
    parseImages(o.image_data).map((src) => ({ src, time: timeOf(o), cap: o.summary, cat: dispOf(o.category).label }))
  )
  if (!items.length) return ''
  const body = items
    .map((it) => {
      const cap = it.cap.length > 90 ? it.cap.slice(0, 90) + '…' : it.cap
      return `<figure class="shot"><a href="${esc(it.src)}" target="_blank" rel="noopener"><img src="${esc(it.src)}" alt="스크린샷" loading="lazy"/></a><figcaption class="shot__cap"><span class="shot__t">${esc(it.time)}</span><span class="shot__c">${esc(it.cat)}</span><br/>${esc(cap)}</figcaption></figure>`
    })
    .join('')
  return `<section class="wrap section" id="sec-shots">${sectionHead('09', '스크린샷 기록', `현장에서 첨부된 화면 캡처 ${items.length}장 — 시각·맥락과 함께 정리했습니다.`)}<div class="shots">${body}</div></section>`
}

function renderTimeline(r: Report): string {
  const sub = imageCount(r.obs)
    ? '관찰 로그를 시각순으로 정렬. 첨부 스크린샷은 아래 「스크린샷 기록」에 모아 정리했습니다(📎 표시).'
    : '관찰 로그를 시각순으로 정렬. 원문 메모를 그대로 보존했습니다.'
  return `<section class="wrap section" id="sec-timeline">${sectionHead('03', '전체 운영 타임라인', sub)}<div class="log">${logRows(r.obs)}</div></section>`
}

function renderIssues(r: Report): string {
  const items = r.obs.filter((o) => dispOf(o.category).key === 'issue' || o.issue || o.solution)
  const body = items.length
    ? items
        .map((o) => {
          const main = esc(o.issue ?? o.summary)
          const fix = o.solution ? esc(o.solution) : '<span class="none">—</span>'
          return `<div class="issue__row"><span class="issue__time">${esc(timeOf(o))}</span><p class="issue__main">${main}</p><p class="issue__fix">${fix}</p></div>`
        })
        .join('')
    : `<div class="issue__row"><span class="issue__time">—</span><p class="issue__main">기록 없음</p><p class="issue__fix"><span class="none">—</span></p></div>`
  return `<section class="wrap section" id="sec-issues">${sectionHead('04', '발생한 이슈와 해결', "현장에서 발생한 막힘·오류와 조치 내역 (분류 '오류·해결')")}<div class="issue">${body}</div></section>`
}

function qaTime(iso: string): string {
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)) } catch { return '—' }
}
function renderQa(r: Report): string {
  type Row = { at: string; time: string; text: string }
  const rows: Row[] = []
  for (const q of r.qna) {
    rows.push({ at: String(q.created_at), time: qaTime(q.created_at), text: q.answer ? `<b>Q.</b> ${esc(q.body)}<br/><b>A.</b> ${esc(q.answer)}` : `<b>Q.</b> ${esc(q.body)}` })
  }
  for (const o of r.obs.filter((o) => dispOf(o.category).key === 'q' || o.question)) {
    rows.push({ at: String(o.created_at), time: timeOf(o), text: o.question && o.answer ? `<b>Q.</b> ${esc(o.question)}<br/><b>A.</b> ${esc(o.answer)}` : esc(o.question ?? o.summary) })
  }
  rows.sort((a, b) => a.at.localeCompare(b.at))
  const body = rows.length
    ? rows.map((x) => `<div class="qa__row"><span class="qa__time">${esc(x.time)}</span><p class="qa__text">${x.text}</p></div>`).join('')
    : `<div class="qa__row"><span class="qa__time">—</span><p class="qa__text">기록 없음</p></div>`
  return `<section class="wrap section" id="sec-qa">${sectionHead('05', '현장 Q&amp;A', '참가자 질문과 강사 응대')}<div class="qa">${body}</div></section>`
}

function renderFlow(r: Report): string {
  const items = r.obs.filter((o) => {
    const k = dispOf(o.category).key
    return k === 'lab' || k === 'flow'
  })
  return `<section class="wrap section" id="sec-flow">${sectionHead('06', '실습·진행 흐름', "도구·실습 진행과 운영 흐름 (분류 '실습·진행', '운영·흐름')")}<div class="log">${logRows(items)}</div></section>`
}

function renderInsights(insights: Insight[]): string {
  const body = insights.length
    ? insights.map((i) => `<div class="insight"><h3 class="insight__h">${esc(i.h)}</h3><p class="insight__p">${esc(i.p)}</p></div>`).join('')
    : `<div class="insight"><h3 class="insight__h">기록 없음</h3><p class="insight__p">회고 인사이트를 도출할 관찰 데이터가 없습니다.</p></div>`
  return `<section class="wrap section" id="sec-insights">${sectionHead('07', '회고 인사이트', '하루 관찰에서 뽑은 핵심')}<div class="insights">${body}</div></section>`
}

function renderBottleneck(b: Bottleneck, no: string, retroNote?: string): string {
  const clusters = b.clusters.length
    ? b.clusters.map((c) => `<div class="insight"><h3 class="insight__h">${esc(c.h)}</h3><p class="insight__p">${esc(c.p)}</p></div>`).join('')
    : '<div class="insight"><h3 class="insight__h">병목 신호 적음</h3><p class="insight__p">두드러진 병목은 적었다.</p></div>'
  const next = b.next.length
    ? `<div class="advice"><p class="advice__label">다음 교육 개선안</p><ul class="advice__list">${b.next.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : ''
  const retro = retroNote
    ? `<div class="advice"><p class="advice__label">운영자 현장 회고 (판단 기준)</p><p class="bn-retro">${esc(retroNote)}</p></div>`
    : ''
  return `<section class="wrap section" id="sec-bottleneck">${sectionHead(no, '병목 분석', '오늘 교육에서 가장 큰 병목과 다음 개선 방향')}${retro}<p class="bn-biggest">가장 큰 병목 — <strong>${esc(b.biggest)}</strong></p><div class="insights">${clusters}</div>${next}</section>`
}

function renderSource(r: Report, no: string): string {
  // 출처는 표기만 — 클릭 링크(<a href>)로 연결하지 않는다(텍스트로 "어디서 가져왔는지"만).
  return `<section class="wrap section appendix" id="sec-source">${sectionHead(no, '데이터 출처', '원문 출처와 처리 원칙')}<div class="note"><ul style="list-style:none; display:grid; gap:.7rem;">
    <li>출처: Lecture LiveOps 상황판</li>
    <li>관찰 시각은 KST(UTC+9) 기준으로 표시했습니다.</li>
    <li>원문 메모는 그대로 보존했습니다 (관찰로그 보호 원칙).</li>
    <li>생성일: ${esc(todayKo())}</li>
  </ul></div></section>`
}

function renderDocument(r: Report, insightsHtml: string, bottleneck: Bottleneck): string {
  const company = r.meta.companyName ?? '기업'
  const hasShots = imageCount(r.obs) > 0
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>${esc(r.title)}</title>
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"/>
${PAGE_STYLE}
</head>
<body>
<header class="mast"><div class="wrap mast__row"><div class="mast__brand"><span class="mast__mark">LIVE<em>·</em>OPS</span><span class="mast__tag">현장 리포트</span></div><span class="mast__meta">${esc(company)} · <b>${esc(r.session.date)}</b></span></div></header>
${renderHero(r)}
${renderToc(hasShots)}
${renderOverview(r)}
${renderSnapshot(r)}
${renderTimeline(r)}
${renderIssues(r)}
${renderQa(r)}
${renderFlow(r)}
${insightsHtml}
${renderBottleneck(bottleneck, '08', r.retroNote)}
${renderShots(r)}
${renderSource(r, hasShots ? '10' : '09')}
<footer class="foot"><div class="wrap foot__row"><span>Lecture LiveOps 관찰일지 · 세션 <code style="font-family:var(--mono);">${esc(r.session.id)}</code></span><span>${esc(r.session.date)} 현장 · 정리 ${esc(todayKo())}</span></div></footer>
</body>
</html>`
}

// ── 공개 API ──────────────────────────────────────────────────
export async function generateSessionHtml(ctx: RlsContext, sessionId: string): Promise<HtmlExport | null> {
  const report = await buildReport(ctx, sessionId)
  if (!report) return null
  // 회고 인사이트 + 병목 분석을 LLM 이 단일 호출로 작성. abort/race 로 60s route 한도 내 확실히 응답.
  const llm = await Promise.race([
    tryLlmAnalysis(report),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), RACE_TIMEOUT_MS))
  ])
  const insights = llm?.analysis.insights.length ? llm.analysis.insights : deterministicInsights(report)
  const bottleneck = llm?.analysis.bottleneck.biggest ? llm.analysis.bottleneck : deterministicBottleneck(report)
  return { html: renderDocument(report, renderInsights(insights), bottleneck), engine: llm?.engine ?? 'fallback', title: report.title }
}

// 여러 세션(예: 목·금)을 하나의 관찰일지로 병합 — 사이트 export 스타일 유지, 결정론 렌더.
export async function generateCombinedHtml(sessionIds: string[], displayTitle?: string): Promise<HtmlExport | null> {
  const reports: Report[] = []
  for (const id of sessionIds) {
    const r = await buildReport(adminContext(id), id)
    if (r) reports.push(r)
  }
  if (!reports.length) return null
  const base = reports[0]
  const dates = [...new Set(reports.map((r) => r.session.date))].join(' · ')
  const merged: Report = {
    session: { ...base.session, date: dates },
    meta: base.meta,
    snapshot: base.snapshot,
    obs: reports.flatMap((r) => r.obs).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    qna: reports.flatMap((r) => r.qna).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    title: displayTitle ?? `${base.meta.companyName ?? ''} 교육 통합 관찰일지 (${dates})`.trim(),
    retroNote: reports.map((r) => r.retroNote).filter(Boolean).join('\n') || undefined
  }
  return { html: renderDocument(merged, renderInsights(deterministicInsights(merged)), deterministicBottleneck(merged)), engine: 'fallback', title: merged.title }
}

// pdf.tsx 호환 — 결정론 HTML (빠름, LLM 미사용).
export async function exportSessionHtml(sessionId: string): Promise<string> {
  const ctx = adminContext(sessionId)
  const report = await buildReport(ctx, sessionId)
  if (!report) return '<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"/><title>세션 없음</title></head><body><p>세션을 찾을 수 없습니다.</p></body></html>'
  return renderDocument(report, renderInsights(deterministicInsights(report)), deterministicBottleneck(report))
}

// ── 디자인 시스템 CSS (nontechnical-korean SSoT 이식, 레퍼런스 정본) ──
const PAGE_STYLE = `<style>
@font-face { font-family: "AtoZ"; font-weight: 100; font-display: swap; src: local("AtoZ Thin"), local("에이투지체-1Thin"); }
@font-face { font-family: "AtoZ"; font-weight: 300; font-display: swap; src: local("AtoZ Light"), local("에이투지체-3Light"); }
@font-face { font-family: "AtoZ"; font-weight: 400; font-display: swap; src: local("AtoZ Regular"), local("에이투지체-4Regular"); }
@font-face { font-family: "AtoZ"; font-weight: 500; font-display: swap; src: local("AtoZ Medium"), local("에이투지체-5Medium"); }
@font-face { font-family: "AtoZ"; font-weight: 600; font-display: swap; src: local("AtoZ SemiBold"), local("에이투지체-6SemiBold"); }
@font-face { font-family: "AtoZ"; font-weight: 700; font-display: swap; src: local("AtoZ Bold"), local("에이투지체-7Bold"); }
@font-face { font-family: "AtoZ"; font-weight: 800; font-display: swap; src: local("AtoZ ExtraBold"), local("에이투지체-8ExtraBold"); }
@font-face { font-family: "AtoZ"; font-weight: 900; font-display: swap; src: local("AtoZ Black"), local("에이투지체-9Black"); }
:root {
  --paper: oklch(0.973 0.009 78); --paper-2: oklch(0.945 0.013 76); --surface: oklch(0.995 0.004 80);
  --ink: oklch(0.245 0.021 52); --ink-soft: oklch(0.405 0.018 52); --ink-mute: oklch(0.565 0.014 58);
  --line: oklch(0.905 0.012 74); --line-2: oklch(0.845 0.015 70);
  --accent: oklch(0.585 0.138 41); --accent-deep: oklch(0.485 0.130 39); --accent-tint: oklch(0.585 0.138 41 / 0.12);
  --cat-issue: oklch(0.62 0.11 38); --cat-q: oklch(0.58 0.05 250); --cat-lab: oklch(0.52 0.02 150); --cat-flow: oklch(0.50 0.018 60);
  --font: "AtoZ", "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --mono: "AtoZ", ui-monospace, "SF Mono", Menlo, monospace;
  --maxw: 70rem; --readw: 46rem; --pad: clamp(1.15rem, 5vw, 3.5rem);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
body { font-family: var(--font); background: var(--paper); color: var(--ink); line-height: 1.72; letter-spacing: -0.006em; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; background-image: radial-gradient(120% 80% at 50% -10%, oklch(0.99 0.006 80) 0%, var(--paper) 55%); background-attachment: fixed; }
::selection { background: var(--accent); color: var(--surface); }
a { color: inherit; text-decoration: none; }
.wrap { width: 100%; max-width: var(--maxw); margin-inline: auto; padding-inline: var(--pad); }
.mast { position: sticky; top: 0; z-index: 50; background: color-mix(in oklch, var(--paper) 82%, transparent); backdrop-filter: saturate(1.3) blur(8px); border-bottom: 1px solid var(--line); }
.mast__row { display: flex; align-items: center; justify-content: space-between; height: 58px; gap: 1rem; }
.mast__brand { display: flex; align-items: baseline; gap: .5rem; }
.mast__mark { font-weight: 900; font-size: 1.04rem; letter-spacing: -0.04em; }
.mast__mark em { color: var(--accent); font-style: normal; }
.mast__tag { font-size: .76rem; color: var(--ink-mute); font-weight: 500; }
.mast__meta { font-size: .76rem; color: var(--ink-mute); font-variant-numeric: tabular-nums; }
.mast__meta b { color: var(--ink); font-weight: 700; }
.hero { padding-top: clamp(3.2rem, 10vw, 6.4rem); padding-bottom: clamp(2rem, 5vw, 3.2rem); }
.hero__eyebrow { font-size: .8rem; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--accent-deep); display: inline-flex; align-items: center; gap: .6rem; }
.hero__eyebrow::before { content: ""; width: 26px; height: 2px; background: var(--accent); display: inline-block; }
.hero__title { font-size: clamp(2.3rem, 6.5vw, 4.6rem); font-weight: 900; line-height: 1.0; letter-spacing: -0.045em; margin-top: 1.1rem; max-width: 20ch; }
.hero__title .soft { color: var(--ink-mute); font-weight: 300; }
.hero__lead { font-size: clamp(1.02rem, 2.1vw, 1.24rem); color: var(--ink-soft); font-weight: 400; margin-top: 1.5rem; max-width: 46ch; line-height: 1.65; }
.hero__rule { height: 1px; background: var(--line-2); margin-top: 2.4rem; }
.hero__stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: .4rem 2rem; margin-top: 1.8rem; }
.hero__stat { display: flex; flex-direction: column; gap: .15rem; padding: .4rem 0; }
.hero__stat-n { font-size: clamp(1.5rem, 3.4vw, 2.1rem); font-weight: 900; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; line-height: 1; }
.hero__stat-n .unit { font-size: .62em; color: var(--ink-mute); font-weight: 600; margin-left: .12em; }
.hero__stat-l { font-size: .76rem; color: var(--ink-mute); font-weight: 500; letter-spacing: .01em; }
.hero__stat--accent .hero__stat-n { color: var(--accent-deep); }
.toc { padding-block: clamp(1.6rem, 4vw, 2.4rem); border-top: 1px solid var(--line); }
.toc__label { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-mute); margin-bottom: 1rem; }
.toc__list { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: .15rem 2rem; }
.toc__item { display: flex; align-items: baseline; gap: .7rem; padding: .5rem 0; border-bottom: 1px solid transparent; transition: border-color .18s ease, color .16s ease; }
.toc__item:hover { border-bottom-color: var(--line-2); }
.toc__item:hover .toc__ko { color: var(--accent-deep); }
.toc__no { font-variant-numeric: tabular-nums; font-size: .72rem; color: var(--ink-mute); font-weight: 600; width: 1.6rem; }
.toc__ko { font-weight: 700; letter-spacing: -0.02em; transition: color .16s ease; }
.section { padding-block: clamp(2.4rem, 5vw, 3.6rem); border-top: 1px solid var(--line); scroll-margin-top: 76px; }
.section__head { display: grid; grid-template-columns: auto 1fr; align-items: end; gap: .5rem 1.1rem; margin-bottom: 1.6rem; }
.section__no { font-size: clamp(2.4rem, 6vw, 3.6rem); font-weight: 900; line-height: .8; color: var(--paper-2); -webkit-text-stroke: 1px var(--line-2); letter-spacing: -0.04em; font-variant-numeric: tabular-nums; grid-row: span 2; }
.section__title { font-size: clamp(1.5rem, 3.6vw, 2.1rem); font-weight: 800; letter-spacing: -0.03em; }
.section__sub { color: var(--ink-mute); font-size: .92rem; align-self: start; margin-top: .3rem; max-width: 56ch; }
.kv { max-width: var(--readw); }
.kv__grid { display: grid; grid-template-columns: minmax(7rem, 11rem) 1fr; gap: 0; border-top: 1px solid var(--line); }
.kv__row { display: contents; }
.kv__row > * { padding: .85rem .2rem; border-bottom: 1px solid var(--line); font-size: .96rem; line-height: 1.6; }
.kv__k { color: var(--ink-mute); font-weight: 600; font-size: .82rem; letter-spacing: .01em; }
.kv__v { color: var(--ink); font-weight: 500; }
.kv__v code { font-family: var(--mono); font-size: .88em; background: var(--paper-2); padding: .08em .36em; border-radius: 5px; color: var(--accent-deep); font-weight: 600; }
@media (max-width: 560px) { .kv__grid { grid-template-columns: 1fr; } .kv__row > * { padding: .3rem .2rem; } .kv__k { padding-top: .8rem; border-bottom: none; } }
.risk { display: inline-flex; align-items: center; gap: .5rem; font-weight: 700; color: var(--accent-deep); }
.risk::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 0 3px var(--accent-tint); }
.advice { max-width: var(--readw); margin-top: 1.8rem; }
.advice__label { font-size: .72rem; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--accent-deep); margin-bottom: .7rem; }
.advice__list { list-style: none; display: grid; gap: .65rem; }
.advice__list li { font-size: 1rem; color: var(--ink); line-height: 1.6; padding-left: 1.4rem; position: relative; }
.advice__list li::before { content: "•"; position: absolute; left: .2rem; top: 0; color: var(--accent); font-size: 1rem; line-height: 1.6; }
.advice__list strong { color: var(--accent-deep); font-weight: 700; }
.log { max-width: var(--readw); border-top: 1px solid var(--line); }
.log__row { display: grid; grid-template-columns: 4.2rem auto 1fr; align-items: baseline; gap: 0 .9rem; padding: .95rem .2rem; border-bottom: 1px solid var(--line); transition: background-color .16s ease; }
.log__row:hover { background: var(--accent-tint); }
.log__time { font-variant-numeric: tabular-nums; font-size: .82rem; font-weight: 700; color: var(--ink); letter-spacing: -.01em; }
.log__cat { display: inline-flex; align-items: center; gap: .38rem; white-space: nowrap; font-size: .74rem; font-weight: 600; color: var(--ink-mute); }
.log__cat .dot { width: 7px; height: 7px; border-radius: 50%; }
.log__cat--issue .dot { background: var(--cat-issue); }
.log__cat--q .dot { background: var(--cat-q); }
.log__cat--lab .dot { background: var(--cat-lab); }
.log__cat--flow .dot { background: var(--cat-flow); }
.log__body { min-width: 0; }
.log__text { font-size: .93rem; color: var(--ink-soft); line-height: 1.55; min-width: 0; }
.log__text strong { color: var(--accent-deep); font-weight: 700; }
.log__shot { font-size: .76rem; color: var(--ink-mute); white-space: nowrap; }
@media (max-width: 600px) { .log__row { grid-template-columns: 3.6rem 1fr; row-gap: .25rem; } .log__cat { grid-column: 2; } .log__body { grid-column: 1 / -1; padding-top: .15rem; } }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1.1rem; }
.shot { margin: 0; }
.shot img { width: 100%; height: 180px; object-fit: cover; border-radius: 10px; border: 1px solid var(--line); display: block; background: var(--paper-2); transition: opacity .16s ease; }
.shot a:hover img { opacity: .9; }
.shot__cap { font-size: .78rem; color: var(--ink-mute); line-height: 1.5; margin-top: .5rem; }
.shot__t { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--ink-soft); margin-right: .4rem; }
.shot__c { color: var(--accent-deep); font-weight: 600; }
.issue { max-width: var(--readw); border-top: 1px solid var(--line); }
.issue__row { display: grid; grid-template-columns: 4.2rem 1fr 1fr; align-items: baseline; gap: 0 .9rem; padding: .95rem .2rem; border-bottom: 1px solid var(--line); transition: background-color .16s ease; }
.issue__row:hover { background: var(--accent-tint); }
.issue__time { font-variant-numeric: tabular-nums; font-size: .82rem; font-weight: 700; color: var(--ink); }
.issue__main { font-size: .93rem; color: var(--ink); line-height: 1.55; font-weight: 500; }
.issue__fix { font-size: .9rem; color: var(--ink-soft); line-height: 1.55; }
.issue__fix .none { color: var(--ink-mute); }
@media (max-width: 640px) { .issue__row { grid-template-columns: 3.6rem 1fr; } .issue__fix { grid-column: 2; padding-top: .15rem; } }
.qa { max-width: var(--readw); border-top: 1px solid var(--line); }
.qa__row { display: grid; grid-template-columns: 4.2rem 1fr; align-items: baseline; gap: 0 .9rem; padding: 1.05rem .2rem; border-bottom: 1px solid var(--line); transition: background-color .16s ease; }
.qa__row:hover { background: var(--accent-tint); }
.qa__time { font-variant-numeric: tabular-nums; font-size: .82rem; font-weight: 700; color: var(--ink); }
.qa__text { font-size: .95rem; color: var(--ink-soft); line-height: 1.62; }
.qa__text b { color: var(--ink); font-weight: 700; }
.insights { max-width: var(--readw); display: grid; gap: 1.5rem; }
.insight__h { font-size: clamp(1.08rem, 2.4vw, 1.28rem); font-weight: 800; color: var(--ink); letter-spacing: -0.025em; margin-bottom: .45rem; line-height: 1.35; }
.insight__h::before { content: ""; display: block; width: 26px; height: 2px; background: var(--accent); margin-bottom: .6rem; }
.insight__p { font-size: 1rem; color: var(--ink-soft); line-height: 1.72; }
.bn-biggest { max-width: var(--readw); font-size: 1.05rem; color: var(--ink); line-height: 1.6; margin-bottom: 1.5rem; }
.bn-biggest strong { color: var(--accent-deep); font-weight: 800; }
.bn-retro { max-width: var(--readw); font-size: .95rem; color: var(--ink-soft); line-height: 1.65; }
.appendix { background: var(--surface); }
.note { font-size: .9rem; color: var(--ink-mute); line-height: 1.6; max-width: var(--readw); }
.note code { font-family: var(--mono); font-size: .88em; background: var(--paper-2); padding: .08em .36em; border-radius: 5px; color: var(--accent-deep); font-weight: 600; }
.note a { color: var(--ink); font-weight: 600; box-shadow: inset 0 -2px 0 var(--line-2); transition: box-shadow .16s ease; }
.note a:hover { box-shadow: inset 0 -2px 0 var(--accent); color: var(--accent-deep); }
.foot { border-top: 1px solid var(--line); padding-block: 2.6rem; margin-top: 1rem; color: var(--ink-mute); font-size: .84rem; }
.foot__row { display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; align-items: baseline; }
.foot a { font-weight: 600; color: var(--ink-soft); box-shadow: inset 0 -1px 0 var(--line-2); }
.foot a:hover { color: var(--accent-deep); box-shadow: inset 0 -1px 0 var(--accent); }
@keyframes reveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
.r { opacity: 0; animation: reveal .7s cubic-bezier(.22,1,.36,1) forwards; }
.r--d1 { animation-delay: .05s; } .r--d2 { animation-delay: .12s; } .r--d3 { animation-delay: .19s; }
.r--d4 { animation-delay: .26s; } .r--d5 { animation-delay: .33s; }
@media print { body { background: #fff; background-image: none; } .section, .log__row, .issue__row, .qa__row { break-inside: avoid; } }
</style>`
