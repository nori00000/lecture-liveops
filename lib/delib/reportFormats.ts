// Lecture LiveOps — 숙의 워크숍 리포트 포맷 변환 (markdown / html / xlsx)
// buildWorkshopReport 결과(WorkshopReport)를 납품 가능한 파일로 렌더한다.
//
// 격리 원칙: 기존 강의 export 함수(planMarkdownExport 등)는 수정하지 않는다.
// delib 전용 신규 함수(planDelib*)로만 격리한다.

import ExcelJS from 'exceljs'
import type { ExportFile } from '@/lib/export/markdown'
import type { WorkshopReport, ReportRound, ReportResultItem, ReportRawStatement, ReportLandscape } from './report'

const DISCLOSURE_LABEL: Record<string, string> = {
  participants: '참가자 공개',
  operators_only: '운영자 전용',
  public: '전체 공개'
}

function disclosureLabel(d: string): string {
  return DISCLOSURE_LABEL[d] ?? d
}

// 결과 항목의 집계 표기 — 억제(표본 부족)는 리포트에서도 수치 대신 문구로.
function tallyText(item: { agree: number; disagree: number; pass: number; total: number }): string {
  return `찬 ${item.agree} · 반 ${item.disagree} · 유보 ${item.pass} (총 ${item.total}표)`
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// F3: 결과 섹션의 근거 스냅샷 출처 — 발행본이면 snapshotId·집계·발행 시각, 미발행이면 생성 시점 집계 표기.
function snapshotSourceText(r: ReportRound): string {
  return r.published
    ? `발행 스냅샷 ${r.snapshotId} · 집계 ${r.computedAt} · 발행 ${r.publishedAt}`
    : `미발행 — 리포트 생성 시점 집계 (${r.computedAt})`
}

const CLUSTER_LABELS = ['가', '나', '다', '라', '마']

function clusterLabel(id: number): string {
  return `${CLUSTER_LABELS[id % CLUSTER_LABELS.length]} 그룹`
}

// Post-MVP B: 의견 지형 요약 (markdown). 비활성이면 사유만 남긴다 — 왜 없는지가 절차 증빙의 일부.
function mdLandscape(ls: ReportLandscape | null): string {
  if (!ls) return '- (의견 지형 미계산 — 발행 스냅샷 없음)\n'
  if (!ls.enabled) return `- 의견 지형 비활성: ${ls.reasonText ?? '사유 미상'} (참가자 ${ls.participantCount}명 · 유효 ${ls.eligibleCount}명)\n`
  const head =
    `- 대상: 유효 참가자 ${ls.eligibleCount}명 / 전체 ${ls.participantCount}명 · 그룹 ${ls.k}개 · 분리도(실루엣) ${pct(ls.silhouette)}\n` +
    `- 그룹 규모: ${ls.clusters.map((c) => `${clusterLabel(c.id)} ${c.size}명`).join(' · ')}\n`
  const gic = ls.gic.length === 0
    ? '  - (해당 항목 없음)\n'
    : ls.gic.map((g) => `  - ${g.body} (GIC ${g.score.toFixed(4)}, statementId=\`${g.statementId}\`)\n`).join('')
  const reps = ls.representatives.length === 0
    ? '  - (해당 항목 없음)\n'
    : ls.representatives
        .map((r) => `  - ${clusterLabel(r.clusterId)}: ${r.body} (그룹 내 찬성 ${pct(r.agreeRate)} · 그룹 밖 대비 +${(r.lift * 100).toFixed(1)}p, statementId=\`${r.statementId}\`)\n`)
        .join('')
  return `${head}- 모든 그룹이 함께 지지한 의견(GIC 상위)\n${gic}- 그룹별 대표 의견\n${reps}`
}

// ============================================================
// Markdown
// ============================================================

function mdResultList(items: ReportResultItem[], kind: 'consensus' | 'divisive' | 'minority'): string {
  if (items.length === 0) return '- (해당 항목 없음)\n'
  return items
    .map((it) => {
      const score = kind === 'consensus' ? `합의강도 ${pct(it.consensusScore)}`
        : kind === 'divisive' ? `갈림강도 ${pct(it.divisiveScore)}`
        : `표차 ${it.margin ?? 0}`
      // traceability: 원 statementId/roundId 를 함께 남긴다.
      return `- **${it.body}**\n  - ${score} · ${tallyText(it)}\n  - 원자료: statementId=\`${it.statementId}\` · roundId=\`${it.roundId ?? '-'}\``
    })
    .join('\n')
}

function mdRawRow(s: ReportRawStatement): string {
  const agg = s.suppressed
    ? '표본 부족(k-익명 억제)'
    : `찬 ${s.agree} / 반 ${s.disagree} / 유보 ${s.pass} / 총 ${s.total}`
  const state = s.moderationState === 'visible' ? '공개' : s.moderationState === 'flagged' ? '신고됨' : '숨김'
  return `| \`${s.statementId}\` | \`${s.roundId ?? '-'}\` | ${s.authorAlias} | ${state} | ${agg} | ${s.body.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`
}

// 워크숍 리포트를 마크다운 파일 묶음으로. planMarkdownExport 와 동일하게 ExportFile[] 반환.
export function planDelibMarkdownExport(report: WorkshopReport): ExportFile[] {
  const o = report.overview
  const p = report.procedure

  const overview =
    `# ${o.title} — 숙의 워크숍 결과 리포트\n\n` +
    `> 절차 증빙형 납품물. 모든 결과 항목은 원 statementId/roundId 에 연결됩니다(traceability).\n` +
    `> 개인 투표 원자료는 포함하지 않으며 집계만 제공합니다(거버넌스 §7-2).\n\n` +
    `## 행사 개요\n` +
    `- 세션: ${o.title} (${o.sessionId})\n` +
    `- 일시: ${o.date}\n` +
    `- 장소: ${o.venue || '(미지정)'}\n` +
    `- 참가자 수: ${o.participantCount}명\n` +
    `- 라운드 수: ${o.roundCount}개\n` +
    `- 발언 수: ${o.statementCount}건\n` +
    `- 리포트 생성 시각: ${o.generatedAt}\n\n` +
    `## 절차 설정\n` +
    `- 익명 모드: ${p.anonymousMode ? '익명' : '기명'}\n` +
    `- 공개 범위: ${disclosureLabel(p.disclosure)}\n` +
    `- 보관 기간: ${p.retentionDays != null ? `${p.retentionDays}일` : '(미지정)'}\n` +
    `- 미성년자 세션: ${p.minorSession ? '예' : '아니오'}\n` +
    `- 사전 합의 확정: ${p.consentConfirmed ? '확정' : '미확정'}\n`

  const rounds =
    `# 라운드별 결과\n\n` +
    (report.rounds.length === 0
      ? '(라운드 없음)\n'
      : report.rounds
          .map((r) => {
            const modeLabel = r.mode === 'plenary' ? '전체' : '분임'
            const statusLabel = r.status === 'active' ? '진행중' : r.status === 'closed' ? '종료' : '대기'
            return (
              `## 라운드 ${r.roundIndex} — ${r.title || '(제목 없음)'}\n` +
              `- 형식: ${modeLabel}(${r.mode}) · 상태: ${statusLabel} · 집계 대상 발언 ${r.statementCount}건\n` +
              `- 결과 근거: ${snapshotSourceText(r)}\n\n` +
              `### 합의점 (consensus)\n${mdResultList(r.consensus, 'consensus')}\n\n` +
              `### 쟁점 (divisive)\n${mdResultList(r.divisive, 'divisive')}\n\n` +
              `### 소수의견 (minority)\n${mdResultList(r.minority, 'minority')}\n\n` +
              `### 의견 지형 (opinion landscape)\n${mdLandscape(r.landscape)}`
            )
          })
          .join('\n'))

  const moderation =
    `# Moderation 내역\n\n` +
    `- 총 ${report.moderation.total}건 (신고 ${report.moderation.byAction.flag} · 숨김 ${report.moderation.byAction.hide} · 복원 ${report.moderation.byAction.restore} · 승인 ${report.moderation.byAction.approve})\n\n` +
    (report.moderation.events.length === 0
      ? '(moderation 기록 없음)\n'
      : '| 시각 | 발언 | 조치 | 주체 | 사유 |\n|---|---|---|---|---|\n' +
        report.moderation.events
          .map((e) => `| ${e.createdAt} | \`${e.statementId}\` | ${e.action} | ${e.actorRole} | ${(e.reason || '-').replace(/\|/g, '\\|')} |`)
          .join('\n') + '\n')

  const raw =
    `# 원자료 (statement 별 집계)\n\n` +
    `> k-익명 억제된 발언은 "표본 부족"으로 표기됩니다. 개인 표는 포함하지 않습니다.\n\n` +
    (report.rawData.length === 0
      ? '(발언 없음)\n'
      : '| statementId | roundId | 작성자 | 상태 | 집계 | 내용 |\n|---|---|---|---|---|---|\n' +
        report.rawData.map(mdRawRow).join('\n') + '\n')

  return [
    { name: '00-리포트-개요.md', content: overview },
    { name: '01-라운드별-결과.md', content: rounds },
    { name: '02-moderation-내역.md', content: moderation },
    { name: '03-원자료.md', content: raw }
  ]
}

// 라우트 다운로드용 — 마크다운 파일 묶음을 단일 문서로 합친다.
export function planDelibMarkdownDocument(report: WorkshopReport): string {
  return planDelibMarkdownExport(report)
    .map((f) => f.content.trimEnd())
    .join('\n\n---\n\n') + '\n'
}

// ============================================================
// HTML (self-contained, 인쇄/납품용)
// ============================================================

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlResultList(items: ReportResultItem[], kind: 'consensus' | 'divisive' | 'minority'): string {
  if (items.length === 0) return '<p class="empty">(해당 항목 없음)</p>'
  const rows = items
    .map((it) => {
      const score = kind === 'consensus' ? `합의강도 ${pct(it.consensusScore)}`
        : kind === 'divisive' ? `갈림강도 ${pct(it.divisiveScore)}`
        : `표차 ${it.margin ?? 0}`
      return (
        `<li><div class="body">${esc(it.body)}</div>` +
        `<div class="meta">${esc(score)} · ${esc(tallyText(it))}</div>` +
        `<div class="trace">원자료: statementId=<code>${esc(it.statementId)}</code> · roundId=<code>${esc(it.roundId ?? '-')}</code></div></li>`
      )
    })
    .join('')
  return `<ul class="results">${rows}</ul>`
}

function htmlLandscape(ls: ReportLandscape | null): string {
  if (!ls) return '<p class="empty">(의견 지형 미계산 — 발행 스냅샷 없음)</p>'
  if (!ls.enabled) {
    return `<p class="empty">의견 지형 비활성: ${esc(ls.reasonText ?? '사유 미상')} (참가자 ${ls.participantCount}명 · 유효 ${ls.eligibleCount}명)</p>`
  }
  const head =
    `<p class="round-meta">유효 참가자 ${ls.eligibleCount}명 / 전체 ${ls.participantCount}명 · 그룹 ${ls.k}개 · 분리도(실루엣) ${pct(ls.silhouette)}</p>` +
    `<p class="round-meta">그룹 규모: ${esc(ls.clusters.map((c) => `${clusterLabel(c.id)} ${c.size}명`).join(' · '))}</p>`
  const gic = ls.gic.length === 0
    ? '<p class="empty">(해당 항목 없음)</p>'
    : `<ul class="results">${ls.gic
        .map((g) => `<li><div class="body">${esc(g.body)}</div><div class="meta">GIC ${g.score.toFixed(4)}</div><div class="trace">statementId=<code>${esc(g.statementId)}</code></div></li>`)
        .join('')}</ul>`
  const reps = ls.representatives.length === 0
    ? '<p class="empty">(해당 항목 없음)</p>'
    : `<ul class="results">${ls.representatives
        .map((r) =>
          `<li><div class="body">${esc(r.body)}</div>` +
          `<div class="meta">${esc(clusterLabel(r.clusterId))} · 그룹 내 찬성 ${pct(r.agreeRate)} · 그룹 밖 대비 +${(r.lift * 100).toFixed(1)}p</div>` +
          `<div class="trace">statementId=<code>${esc(r.statementId)}</code></div></li>`
        )
        .join('')}</ul>`
  return `${head}<h5>모든 그룹이 함께 지지한 의견 (GIC 상위)</h5>${gic}<h5>그룹별 대표 의견</h5>${reps}`
}

export function planDelibHtmlExport(report: WorkshopReport): string {
  const o = report.overview
  const p = report.procedure

  const roundsHtml = report.rounds.length === 0
    ? '<p class="empty">(라운드 없음)</p>'
    : report.rounds
        .map((r) => {
          const modeLabel = r.mode === 'plenary' ? '전체' : '분임'
          const statusLabel = r.status === 'active' ? '진행중' : r.status === 'closed' ? '종료' : '대기'
          return (
            `<section class="round"><h3>라운드 ${r.roundIndex} — ${esc(r.title || '(제목 없음)')}</h3>` +
            `<p class="round-meta">형식 ${modeLabel}(${r.mode}) · 상태 ${statusLabel} · 집계 대상 발언 ${r.statementCount}건</p>` +
            `<p class="round-meta">결과 근거: ${esc(snapshotSourceText(r))}</p>` +
            `<h4>합의점 (consensus)</h4>${htmlResultList(r.consensus, 'consensus')}` +
            `<h4>쟁점 (divisive)</h4>${htmlResultList(r.divisive, 'divisive')}` +
            `<h4>소수의견 (minority)</h4>${htmlResultList(r.minority, 'minority')}` +
            `<h4>의견 지형 (opinion landscape)</h4>${htmlLandscape(r.landscape)}</section>`
          )
        })
        .join('')

  const modRows = report.moderation.events.length === 0
    ? '<tr><td colspan="5" class="empty">(moderation 기록 없음)</td></tr>'
    : report.moderation.events
        .map((e) => `<tr><td>${esc(e.createdAt)}</td><td><code>${esc(e.statementId)}</code></td><td>${esc(e.action)}</td><td>${esc(e.actorRole)}</td><td>${esc(e.reason || '-')}</td></tr>`)
        .join('')

  const rawRows = report.rawData.length === 0
    ? '<tr><td colspan="6" class="empty">(발언 없음)</td></tr>'
    : report.rawData
        .map((s) => {
          const agg = s.suppressed ? '표본 부족(k-익명 억제)' : `찬 ${s.agree} / 반 ${s.disagree} / 유보 ${s.pass} / 총 ${s.total}`
          const state = s.moderationState === 'visible' ? '공개' : s.moderationState === 'flagged' ? '신고됨' : '숨김'
          return `<tr><td><code>${esc(s.statementId)}</code></td><td><code>${esc(s.roundId ?? '-')}</code></td><td>${esc(s.authorAlias)}</td><td>${esc(state)}</td><td>${esc(agg)}</td><td>${esc(s.body)}</td></tr>`
        })
        .join('')

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(o.title)} — 숙의 워크숍 결과 리포트</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Apple SD Gothic Neo", sans-serif; line-height: 1.6; max-width: 960px; margin: 0 auto; padding: 24px; color: #1a1a1a; }
  h1 { font-size: 1.6rem; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  h3 { font-size: 1.1rem; margin-top: 1.5rem; }
  h4 { font-size: 0.95rem; margin: 1rem 0 0.25rem; color: #444; }
  h5 { font-size: 0.9rem; margin: 0.75rem 0 0.25rem; color: #555; }
  .note { color: #666; font-size: 0.85rem; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; }
  dt { font-weight: 600; color: #555; }
  ul.results { list-style: none; padding: 0; }
  ul.results li { border: 1px solid #ddd; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px; }
  ul.results .body { font-weight: 600; }
  ul.results .meta { font-size: 0.85rem; color: #555; margin-top: 2px; }
  ul.results .trace { font-size: 0.75rem; color: #888; margin-top: 4px; }
  code { background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; font-size: 0.8em; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85rem; overflow-x: auto; display: block; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: rgba(0,0,0,0.04); }
  .empty { color: #999; font-style: italic; }
</style></head>
<body>
<h1>${esc(o.title)} — 숙의 워크숍 결과 리포트</h1>
<p class="note">절차 증빙형 납품물. 모든 결과 항목은 원 statementId/roundId 에 연결됩니다(traceability). 개인 투표 원자료는 포함하지 않으며 집계만 제공합니다.</p>

<h2>행사 개요</h2>
<dl>
  <dt>세션</dt><dd>${esc(o.title)} (<code>${esc(o.sessionId)}</code>)</dd>
  <dt>일시</dt><dd>${esc(o.date)}</dd>
  <dt>장소</dt><dd>${esc(o.venue || '(미지정)')}</dd>
  <dt>참가자 수</dt><dd>${o.participantCount}명</dd>
  <dt>라운드 수</dt><dd>${o.roundCount}개</dd>
  <dt>발언 수</dt><dd>${o.statementCount}건</dd>
  <dt>생성 시각</dt><dd>${esc(o.generatedAt)}</dd>
</dl>

<h2>절차 설정</h2>
<dl>
  <dt>익명 모드</dt><dd>${p.anonymousMode ? '익명' : '기명'}</dd>
  <dt>공개 범위</dt><dd>${esc(disclosureLabel(p.disclosure))}</dd>
  <dt>보관 기간</dt><dd>${p.retentionDays != null ? `${p.retentionDays}일` : '(미지정)'}</dd>
  <dt>미성년자 세션</dt><dd>${p.minorSession ? '예' : '아니오'}</dd>
  <dt>사전 합의</dt><dd>${p.consentConfirmed ? '확정' : '미확정'}</dd>
</dl>

<h2>라운드별 결과</h2>
${roundsHtml}

<h2>Moderation 내역</h2>
<p class="note">총 ${report.moderation.total}건 (신고 ${report.moderation.byAction.flag} · 숨김 ${report.moderation.byAction.hide} · 복원 ${report.moderation.byAction.restore} · 승인 ${report.moderation.byAction.approve})</p>
<table><thead><tr><th>시각</th><th>발언</th><th>조치</th><th>주체</th><th>사유</th></tr></thead><tbody>${modRows}</tbody></table>

<h2>원자료 (statement 별 집계)</h2>
<p class="note">k-익명 억제된 발언은 "표본 부족"으로 표기됩니다. 개인 표는 포함하지 않습니다.</p>
<table><thead><tr><th>statementId</th><th>roundId</th><th>작성자</th><th>상태</th><th>집계</th><th>내용</th></tr></thead><tbody>${rawRows}</tbody></table>
</body></html>`
}

// ============================================================
// XLSX (exceljs — excel.ts 패턴 재사용)
// ============================================================

export async function planDelibXlsxBuffer(report: WorkshopReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Lecture LiveOps'
  wb.created = new Date()

  // 시트 1: 개요 + 절차
  const overview = wb.addWorksheet('개요')
  const o = report.overview
  const p = report.procedure
  overview.columns = [{ width: 20 }, { width: 60 }]
  overview.addRows([
    ['세션', `${o.title} (${o.sessionId})`],
    ['일시', o.date],
    ['장소', o.venue || '(미지정)'],
    ['참가자 수', o.participantCount],
    ['라운드 수', o.roundCount],
    ['발언 수', o.statementCount],
    ['생성 시각', o.generatedAt],
    ['익명 모드', p.anonymousMode ? '익명' : '기명'],
    ['공개 범위', disclosureLabel(p.disclosure)],
    ['보관 기간', p.retentionDays != null ? `${p.retentionDays}일` : '(미지정)'],
    ['미성년자 세션', p.minorSession ? '예' : '아니오'],
    ['사전 합의', p.consentConfirmed ? '확정' : '미확정']
  ])
  // F3: 라운드별 결과 근거 스냅샷 출처 (snapshotId·집계·발행 시각 또는 미발행 표시).
  for (const r of report.rounds) {
    overview.addRow([`라운드 ${r.roundIndex} 결과 근거`, snapshotSourceText(r)])
  }

  // 시트 2: 라운드별 결과 (consensus/divisive/minority 를 한 시트에 kind 열로)
  const results = wb.addWorksheet('라운드별 결과')
  results.columns = [
    { header: '라운드', key: 'round', width: 8 },
    { header: '유형', key: 'kind', width: 12 },
    { header: '내용', key: 'body', width: 50 },
    { header: '지표', key: 'score', width: 14 },
    { header: '찬', key: 'agree', width: 6 },
    { header: '반', key: 'disagree', width: 6 },
    { header: '유보', key: 'pass', width: 6 },
    { header: '총표', key: 'total', width: 6 },
    { header: 'statementId', key: 'statementId', width: 16 },
    { header: 'roundId', key: 'roundId', width: 16 }
  ]
  for (const r of report.rounds) {
    const push = (items: ReportResultItem[], kind: string, scoreFn: (it: ReportResultItem) => string) => {
      for (const it of items) {
        results.addRow({
          round: r.roundIndex, kind, body: it.body, score: scoreFn(it),
          agree: it.agree, disagree: it.disagree, pass: it.pass, total: it.total,
          statementId: it.statementId, roundId: it.roundId ?? '-'
        })
      }
    }
    push(r.consensus, '합의점', (it) => `합의 ${pct(it.consensusScore)}`)
    push(r.divisive, '쟁점', (it) => `갈림 ${pct(it.divisiveScore)}`)
    push(r.minority, '소수의견', (it) => `표차 ${it.margin ?? 0}`)
  }

  // 시트 3: 의견 지형 (Post-MVP B) — 클러스터 규모 / GIC 상위 / 그룹별 대표의견. 좌표는 담지 않는다.
  const land = wb.addWorksheet('의견 지형')
  land.columns = [
    { header: '라운드', key: 'round', width: 8 },
    { header: '구분', key: 'kind', width: 14 },
    { header: '그룹', key: 'cluster', width: 10 },
    { header: '내용', key: 'body', width: 50 },
    { header: '지표', key: 'score', width: 24 },
    { header: 'statementId', key: 'statementId', width: 16 }
  ]
  for (const r of report.rounds) {
    const ls = r.landscape
    if (!ls) {
      land.addRow({ round: r.roundIndex, kind: '미계산', cluster: '-', body: '발행 스냅샷 없음', score: '-', statementId: '-' })
      continue
    }
    if (!ls.enabled) {
      land.addRow({ round: r.roundIndex, kind: '비활성', cluster: '-', body: ls.reasonText ?? '사유 미상', score: `참가자 ${ls.participantCount} / 유효 ${ls.eligibleCount}`, statementId: '-' })
      continue
    }
    for (const c of ls.clusters) {
      land.addRow({ round: r.roundIndex, kind: '그룹 규모', cluster: clusterLabel(c.id), body: `${c.size}명`, score: `실루엣 ${pct(ls.silhouette)}`, statementId: '-' })
    }
    for (const g of ls.gic) {
      land.addRow({ round: r.roundIndex, kind: 'GIC 상위', cluster: '전체', body: g.body, score: `GIC ${g.score.toFixed(4)}`, statementId: g.statementId })
    }
    for (const rep of ls.representatives) {
      land.addRow({
        round: r.roundIndex, kind: '대표 의견', cluster: clusterLabel(rep.clusterId), body: rep.body,
        score: `찬성 ${pct(rep.agreeRate)} · +${(rep.lift * 100).toFixed(1)}p`, statementId: rep.statementId
      })
    }
  }

  // 시트 4: moderation 내역
  const mod = wb.addWorksheet('moderation')
  mod.columns = [
    { header: '시각', key: 'createdAt', width: 26 },
    { header: 'statementId', key: 'statementId', width: 16 },
    { header: '조치', key: 'action', width: 10 },
    { header: '주체', key: 'actorRole', width: 12 },
    { header: '사유', key: 'reason', width: 30 }
  ]
  for (const e of report.moderation.events) {
    mod.addRow({ createdAt: e.createdAt, statementId: e.statementId, action: e.action, actorRole: e.actorRole, reason: e.reason || '-' })
  }

  // 시트 5: 원자료 (statement 별 집계 — k-익명 억제 반영)
  const raw = wb.addWorksheet('원자료')
  raw.columns = [
    { header: 'statementId', key: 'statementId', width: 16 },
    { header: 'roundId', key: 'roundId', width: 16 },
    { header: '작성자', key: 'author', width: 14 },
    { header: '상태', key: 'state', width: 8 },
    { header: '찬', key: 'agree', width: 6 },
    { header: '반', key: 'disagree', width: 6 },
    { header: '유보', key: 'pass', width: 6 },
    { header: '총표', key: 'total', width: 6 },
    { header: '집계', key: 'agg', width: 20 },
    { header: '내용', key: 'body', width: 50 }
  ]
  for (const s of report.rawData) {
    const state = s.moderationState === 'visible' ? '공개' : s.moderationState === 'flagged' ? '신고됨' : '숨김'
    raw.addRow({
      statementId: s.statementId, roundId: s.roundId ?? '-', author: s.authorAlias, state,
      agree: s.suppressed ? '' : s.agree,
      disagree: s.suppressed ? '' : s.disagree,
      pass: s.suppressed ? '' : s.pass,
      total: s.suppressed ? '' : s.total,
      agg: s.suppressed ? '표본 부족(k-익명 억제)' : '집계됨',
      body: s.body
    })
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
