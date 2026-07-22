// Lecture LiveOps — 숙의 워크숍 리포트 포맷 변환 (markdown / html / xlsx)
// buildWorkshopReport 결과(WorkshopReport)를 납품 가능한 파일로 렌더한다.
//
// 격리 원칙: 기존 강의 export 함수(planMarkdownExport 등)는 수정하지 않는다.
// delib 전용 신규 함수(planDelib*)로만 격리한다.

import ExcelJS from 'exceljs'
import type { ExportFile } from '@/lib/export/markdown'
import type { WorkshopReport, ReportRound, ReportResultItem, ReportRawStatement, ReportLandscape, ReportAiObservation, QualityMetricStatus } from './report'
import type { EvidenceKindBreakdown, EvidenceKindDistribution } from './metrics'

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

function maybePct(n: number | null): string {
  return n == null ? '실측 부족' : pct(n)
}

function qualityStatusLabel(status: QualityMetricStatus): string {
  if (status === 'pass') return '통과'
  if (status === 'fail') return '재검토'
  return '실측 부족'
}

function qualitySummaryMd(report: WorkshopReport): string {
  const q = report.qualityMetrics
  return (
    `## 숙의 품질 게이트\n` +
    `- Q1 추정 태그 비율: ${maybePct(q.q1EstimateTag.estimateRatio)} ` +
    `(추정 ${q.q1EstimateTag.estimateCount}건 / visible 발언 ${q.q1EstimateTag.visibleStatementCount}건) — ${qualityStatusLabel(q.q1EstimateTag.status)}\n` +
    `- Q2 검토 후보 채택률: ${maybePct(q.q2ReviewAdoption.adoptionRate)} ` +
    `(승인 ${q.q2ReviewAdoption.approvedCount} · 기각 ${q.q2ReviewAdoption.rejectedCount} · 대기 ${q.q2ReviewAdoption.pendingCount}) — ${qualityStatusLabel(q.q2ReviewAdoption.status)}\n` +
    `- Q5 공통지반 요약 착수 조건: ${qualityStatusLabel(q.q5Prerequisite.status)} — ${q.q5Prerequisite.reason}\n`
  )
}

// F3: 결과 섹션의 근거 스냅샷 출처 — 발행본이면 snapshotId·집계·발행 시각, 미발행이면 생성 시점 집계 표기.
function snapshotSourceText(r: ReportRound): string {
  return r.published
    ? `발행 스냅샷 ${r.snapshotId} · 집계 ${r.computedAt} · 발행 ${r.publishedAt}`
    : `미발행 — 리포트 생성 시점 집계 (${r.computedAt})`
}

// Q1 근거 유형 분포 — 참가자 자기 태깅 집계. 판정이 아니라 본인 표기임을 납품물에도 명시한다.
const EVIDENCE_ORDER: Array<{ key: 'experience' | 'source' | 'estimate' | 'unspecified'; label: string }> = [
  { key: 'experience', label: '경험(직접 겪음)' },
  { key: 'source', label: '자료·출처(근거 있음)' },
  { key: 'estimate', label: '추정(제 생각)' },
  { key: 'unspecified', label: '미지정' }
]

const EVIDENCE_NOTE =
  '참가자가 스스로 고른 근거 유형입니다. 시스템이 발언을 판정하지 않으므로 오탐이 없으며, 자기보고이므로 실제 근거 수준과 다를 수 있습니다. ' +
  '개인 단위는 표기하지 않고 기여자 3명 미만 그룹은 억제합니다.'

const EVIDENCE_SUPPRESSED_TEXT = '표본 부족(기여자 3명 미만) — 개인 태깅 역추론 방지를 위해 미표기'

function evidenceLine(d: EvidenceKindDistribution): string {
  if (d.suppressed) return EVIDENCE_SUPPRESSED_TEXT
  if (d.total === 0) return '집계 대상 발언 없음'
  return EVIDENCE_ORDER.map((o) => `${o.label} ${d.counts[o.key]}건(${pct(d.ratios[o.key])})`).join(' · ') + ` — 총 ${d.total}건`
}

// Q2 검토가 필요한 주장 — AI 생성물 라벨(§7-5) + 승인 절차를 납품물에도 명시한다.
const AI_OBS_NOTE =
  'AI가 자동으로 뽑은 초안을 퍼실리테이터가 검토해 **승인한 항목만** 실었습니다. ' +
  '발언의 옳고 그름을 판정한 것이 아니라 "근거를 더 확인해볼 지점"을 표시한 것이며, 개인·진영을 지칭하지 않습니다. ' +
  '워크숍 진행 중 참가자에게는 표시되지 않았습니다.'

const AI_OBS_KIND_LABEL: Record<ReportAiObservation['kind'], string> = {
  evidence_check: '근거 확인 필요',
  definition_mismatch: '용어 정의 불일치'
}

const CLUSTER_LABELS = ['가', '나', '다', '라', '마']

function clusterLabel(id: number): string {
  return `${CLUSTER_LABELS[id % CLUSTER_LABELS.length]} 그룹`
}

// Post-MVP B: 의견 지형 요약 (markdown). 비활성이면 사유만 남긴다 — 왜 없는지가 절차 증빙의 일부.
// 회피 발언(C5) — 활성/비활성 공통으로 붙인다.
function mdAvoided(ls: ReportLandscape): string {
  if (ls.avoidedStatements.length === 0) return ''
  return (
    `- 응답 회피가 높은 발언 (결측률 40% 초과 — 클러스터링 입력에서 제외, 회피 자체가 정보)\n` +
    ls.avoidedStatements
      .map((a) => `  - ${a.body} (결측률 ${pct(a.missingRate)} · 응답 ${a.votes}표, statementId=\`${a.statementId}\`)\n`)
      .join('')
  )
}

function mdLandscape(ls: ReportLandscape | null): string {
  if (!ls) return '- (의견 지형 미계산 — 발행 스냅샷 없음)\n'
  if (!ls.enabled) {
    return (
      `- 의견 지형 비활성: ${ls.reasonText ?? '사유 미상'} (참가자 ${ls.participantCount}명 · 유효 ${ls.eligibleCount}명)\n` +
      (ls.permutation
        ? `  - 순열검정: 관측 분리도 ${ls.permutation.observed.toFixed(3)} · 무작위 기준선(95th) ${ls.permutation.threshold95.toFixed(3)} · p=${ls.permutation.pValue.toFixed(4)} (${ls.permutation.iterations}회)\n`
        : '') +
      mdAvoided(ls)
    )
  }
  const head =
    `- 대상: 유효 참가자 ${ls.eligibleCount}명 / 전체 ${ls.participantCount}명 · 그룹 ${ls.k}개 · 분리도(실루엣) ${pct(ls.silhouette)}\n` +
    `- 분석 발언 ${ls.analyzedStatementCount}건 · 2D 설명분산 ${pct(ls.explainedVarianceRatio)}\n` +
    (ls.permutation
      ? `- 순열검정 통과: 관측 ${ls.permutation.observed.toFixed(3)} > 무작위 기준선(95th) ${ls.permutation.threshold95.toFixed(3)} · p=${ls.permutation.pValue.toFixed(4)} (${ls.permutation.iterations}회)\n`
      : '') +
    (ls.varianceWarning ? `- ⚠ ${ls.varianceWarning}\n` : '') +
    (ls.stabilityWarning ? `- ⚠ ${ls.stabilityWarning}\n` : '') +
    `- 그룹 규모: ${ls.clusters.map((c) => `${clusterLabel(c.id)} ${c.size}명`).join(' · ')}\n`
  const gic = ls.gic.length === 0
    ? '  - (해당 항목 없음)\n'
    : ls.gic
        .map((g) => {
          const detail = g.perCluster
            .map((c) => `${clusterLabel(c.clusterId)} ${pct(c.agreeRate)}[${pct(c.ciLow)}~${pct(c.ciHigh)}] n=${c.votes}`)
            .join(' · ')
          return `  - ${g.body} (GIC 기하평균 ${g.score.toFixed(4)}; ${detail}, statementId=\`${g.statementId}\`)\n`
        })
        .join('')
  const reps = ls.representatives.length === 0
    ? '  - (이 그룹들을 뚜렷이 구분짓는 발언이 통계적으로 확인되지 않았습니다 — FDR 보정 후 유의 항목 0건)\n'
    : ls.representatives
        .map((r) =>
          `  - ${clusterLabel(r.clusterId)} ${r.rank}순위: ${r.body} (그룹 내 찬성 ${pct(r.agreeRate)} · 그룹 밖 대비 +${(r.lift * 100).toFixed(1)}p · ` +
          `보정 p=${r.pAdjusted.toExponential(2)}(${r.test === 'fisher' ? 'Fisher 정확검정' : 'z-검정'}, BH FDR) · 그룹 내 유효표 ${r.insideVotes}, statementId=\`${r.statementId}\`)\n`
        )
        .join('')
  return `${head}- 모든 그룹이 함께 지지한 의견(GIC 상위)\n${gic}- 그룹별 대표 의견\n${reps}${mdAvoided(ls)}`
}

function mdEvidence(e: EvidenceKindBreakdown): string {
  const head = `- 라운드 전체: ${evidenceLine(e.overall)}\n`
  const groups = e.byGroup.length === 0
    ? '  - (그룹 배정된 발언 없음)\n'
    : e.byGroup.map((g) => `  - 그룹 \`${g.groupId}\`: ${evidenceLine(g.distribution)}\n`).join('')
  return `${head}- 그룹별\n${groups}`
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
    `- 사전 합의 확정: ${p.consentConfirmed ? '확정' : '미확정'}\n\n` +
    qualitySummaryMd(report)

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
              `### 의견 지형 (opinion landscape)\n${mdLandscape(r.landscape)}\n` +
              `### 근거 유형 분포 (참가자 자기 태깅)\n> ${EVIDENCE_NOTE}\n\n${mdEvidence(r.evidenceKind)}`
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

  // Q2: 승인된 항목이 0건이면 섹션(파일) 자체를 만들지 않는다 — 빈 섹션은 납품물에 넣지 않는다.
  const aiObs = report.aiObservations.length === 0
    ? []
    : [{
        name: '04-검토가-필요한-주장.md',
        content:
          `# 검토가 필요한 주장 (AI 초안 · 퍼실리테이터 승인)\n\n` +
          `> ${AI_OBS_NOTE}\n\n` +
          report.aiObservations
            .map((o) =>
              `## ${AI_OBS_KIND_LABEL[o.kind]}\n` +
              `- 원 발언: ${o.statementBody.replace(/\n/g, ' ')}\n` +
              `- 관찰: ${o.body}\n` +
              (o.suggestedQuestion ? `- 제안 질문: ${o.suggestedQuestion}\n` : '') +
              `- 원자료: statementId=\`${o.statementId}\` · roundId=\`${o.roundId ?? '-'}\`\n`
            )
            .join('\n')
      }]

  return [
    { name: '00-리포트-개요.md', content: overview },
    { name: '01-라운드별-결과.md', content: rounds },
    { name: '02-moderation-내역.md', content: moderation },
    { name: '03-원자료.md', content: raw },
    ...aiObs
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

function htmlAvoided(ls: ReportLandscape): string {
  if (ls.avoidedStatements.length === 0) return ''
  return (
    `<h5>응답 회피가 높은 발언</h5>` +
    `<p class="round-meta">결측률 40% 초과 — 클러스터링 입력에서 제외했습니다. 삭제가 아니라 별도 표기입니다(회피 자체가 정보).</p>` +
    `<ul class="results">${ls.avoidedStatements
      .map((a) =>
        `<li><div class="body">${esc(a.body)}</div><div class="meta">결측률 ${pct(a.missingRate)} · 응답 ${a.votes}표</div>` +
        `<div class="trace">statementId=<code>${esc(a.statementId)}</code></div></li>`
      )
      .join('')}</ul>`
  )
}

function htmlLandscape(ls: ReportLandscape | null): string {
  if (!ls) return '<p class="empty">(의견 지형 미계산 — 발행 스냅샷 없음)</p>'
  if (!ls.enabled) {
    return (
      `<p class="empty">의견 지형 비활성: ${esc(ls.reasonText ?? '사유 미상')} (참가자 ${ls.participantCount}명 · 유효 ${ls.eligibleCount}명)</p>` +
      (ls.permutation
        ? `<p class="round-meta">순열검정: 관측 분리도 ${ls.permutation.observed.toFixed(3)} · 무작위 기준선(95th) ${ls.permutation.threshold95.toFixed(3)} · p=${ls.permutation.pValue.toFixed(4)} (${ls.permutation.iterations}회)</p>`
        : '') +
      htmlAvoided(ls)
    )
  }
  const head =
    `<p class="round-meta">유효 참가자 ${ls.eligibleCount}명 / 전체 ${ls.participantCount}명 · 그룹 ${ls.k}개 · 분리도(실루엣) ${pct(ls.silhouette)}</p>` +
    `<p class="round-meta">분석 발언 ${ls.analyzedStatementCount}건 · 2D 설명분산 ${pct(ls.explainedVarianceRatio)}</p>` +
    (ls.permutation
      ? `<p class="round-meta">순열검정 통과: 관측 ${ls.permutation.observed.toFixed(3)} &gt; 무작위 기준선(95th) ${ls.permutation.threshold95.toFixed(3)} · p=${ls.permutation.pValue.toFixed(4)} (${ls.permutation.iterations}회)</p>`
      : '') +
    (ls.varianceWarning ? `<p class="warn">⚠ ${esc(ls.varianceWarning)}</p>` : '') +
    (ls.stabilityWarning ? `<p class="warn">⚠ ${esc(ls.stabilityWarning)}</p>` : '') +
    `<p class="round-meta">그룹 규모: ${esc(ls.clusters.map((c) => `${clusterLabel(c.id)} ${c.size}명`).join(' · '))}</p>`
  const gic = ls.gic.length === 0
    ? '<p class="empty">(해당 항목 없음)</p>'
    : `<ul class="results">${ls.gic
        .map((g) => {
          const detail = g.perCluster
            .map((c) => `${clusterLabel(c.clusterId)} ${pct(c.agreeRate)}[${pct(c.ciLow)}~${pct(c.ciHigh)}] n=${c.votes}`)
            .join(' · ')
          return `<li><div class="body">${esc(g.body)}</div><div class="meta">GIC 기하평균 ${g.score.toFixed(4)} · ${esc(detail)}</div><div class="trace">statementId=<code>${esc(g.statementId)}</code></div></li>`
        })
        .join('')}</ul>`
  const reps = ls.representatives.length === 0
    ? '<p class="empty">이 그룹들을 뚜렷이 구분짓는 발언이 통계적으로 확인되지 않았습니다 (FDR 보정 후 유의 항목 0건)</p>'
    : `<ul class="results">${ls.representatives
        .map((r) =>
          `<li><div class="body">${esc(r.body)}</div>` +
          `<div class="meta">${esc(clusterLabel(r.clusterId))} ${r.rank}순위 · 그룹 내 찬성 ${pct(r.agreeRate)} · 그룹 밖 대비 +${(r.lift * 100).toFixed(1)}p · ` +
          `보정 p=${r.pAdjusted.toExponential(2)} (${r.test === 'fisher' ? 'Fisher 정확검정' : 'z-검정'}, BH FDR) · 그룹 내 유효표 ${r.insideVotes}</div>` +
          `<div class="trace">statementId=<code>${esc(r.statementId)}</code></div></li>`
        )
        .join('')}</ul>`
  return `${head}<h5>모든 그룹이 함께 지지한 의견 (GIC 상위)</h5>${gic}<h5>그룹별 대표 의견</h5>${reps}${htmlAvoided(ls)}`
}

function htmlEvidence(e: EvidenceKindBreakdown): string {
  const rows = [
    `<li><div class="body">라운드 전체</div><div class="meta">${esc(evidenceLine(e.overall))}</div></li>`,
    ...e.byGroup.map(
      (g) => `<li><div class="body">그룹 <code>${esc(g.groupId)}</code></div><div class="meta">${esc(evidenceLine(g.distribution))}</div></li>`
    )
  ].join('')
  return `<p class="note">${esc(EVIDENCE_NOTE)}</p><ul class="results">${rows}</ul>`
}

export function planDelibHtmlExport(report: WorkshopReport): string {
  const o = report.overview
  const p = report.procedure
  const q = report.qualityMetrics

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
            `<h4>의견 지형 (opinion landscape)</h4>${htmlLandscape(r.landscape)}` +
            `<h4>근거 유형 분포 (참가자 자기 태깅)</h4>${htmlEvidence(r.evidenceKind)}</section>`
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

  // Q2: 승인 0건이면 섹션 자체를 렌더하지 않는다 (빈 표·빈 제목 없음).
  const aiObsHtml = report.aiObservations.length === 0
    ? ''
    : `<h2>검토가 필요한 주장 <span class="ai-tag">AI 초안 · 퍼실리테이터 승인</span></h2>\n` +
      `<p class="note">${esc(AI_OBS_NOTE.replace(/\*\*/g, ''))}</p>\n` +
      `<ul class="results">${report.aiObservations
        .map((o) =>
          `<li><div class="body">${esc(o.statementBody)}</div>` +
          `<div class="meta">${esc(AI_OBS_KIND_LABEL[o.kind])} — ${esc(o.body)}</div>` +
          (o.suggestedQuestion ? `<div class="meta">제안 질문: ${esc(o.suggestedQuestion)}</div>` : '') +
          `<div class="trace">statementId=<code>${esc(o.statementId)}</code> · roundId=<code>${esc(o.roundId ?? '-')}</code></div></li>`
        )
        .join('')}</ul>\n`

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
  .warn { color: #8a5b00; background: #fff6e0; border: 1px solid #e8c97a; border-radius: 4px; padding: 6px 10px; margin: 6px 0; font-size: 0.85rem; }
  .ai-tag { font-size: 0.7rem; font-weight: 500; color: #3a5a8a; background: #eaf1fb; border: 1px solid #c3d6f0; border-radius: 999px; padding: 2px 8px; vertical-align: middle; }
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

<h2>숙의 품질 게이트</h2>
<dl>
  <dt>Q1 추정 태그 비율</dt><dd>${esc(maybePct(q.q1EstimateTag.estimateRatio))} (추정 ${q.q1EstimateTag.estimateCount}건 / visible 발언 ${q.q1EstimateTag.visibleStatementCount}건) — ${esc(qualityStatusLabel(q.q1EstimateTag.status))}</dd>
  <dt>Q2 후보 채택률</dt><dd>${esc(maybePct(q.q2ReviewAdoption.adoptionRate))} (승인 ${q.q2ReviewAdoption.approvedCount} · 기각 ${q.q2ReviewAdoption.rejectedCount} · 대기 ${q.q2ReviewAdoption.pendingCount}) — ${esc(qualityStatusLabel(q.q2ReviewAdoption.status))}</dd>
  <dt>Q5 착수 조건</dt><dd>${esc(qualityStatusLabel(q.q5Prerequisite.status))} — ${esc(q.q5Prerequisite.reason)}</dd>
</dl>

<h2>라운드별 결과</h2>
${roundsHtml}

<h2>Moderation 내역</h2>
<p class="note">총 ${report.moderation.total}건 (신고 ${report.moderation.byAction.flag} · 숨김 ${report.moderation.byAction.hide} · 복원 ${report.moderation.byAction.restore} · 승인 ${report.moderation.byAction.approve})</p>
<table><thead><tr><th>시각</th><th>발언</th><th>조치</th><th>주체</th><th>사유</th></tr></thead><tbody>${modRows}</tbody></table>

${aiObsHtml}
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
  const q = report.qualityMetrics
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
    ['사전 합의', p.consentConfirmed ? '확정' : '미확정'],
    ['품질 게이트', ''],
    ['Q1 추정 태그 비율', `${maybePct(q.q1EstimateTag.estimateRatio)} — ${qualityStatusLabel(q.q1EstimateTag.status)} (추정 ${q.q1EstimateTag.estimateCount} / visible ${q.q1EstimateTag.visibleStatementCount})`],
    ['Q2 후보 채택률', `${maybePct(q.q2ReviewAdoption.adoptionRate)} — ${qualityStatusLabel(q.q2ReviewAdoption.status)} (승인 ${q.q2ReviewAdoption.approvedCount} / 기각 ${q.q2ReviewAdoption.rejectedCount} / 대기 ${q.q2ReviewAdoption.pendingCount})`],
    ['Q5 착수 조건', `${qualityStatusLabel(q.q5Prerequisite.status)} — ${q.q5Prerequisite.reason}`]
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
    // C5: 회피 발언은 활성/비활성과 무관하게 기록한다.
    const addAvoided = () => {
      for (const a of ls.avoidedStatements) {
        land.addRow({
          round: r.roundIndex, kind: '응답 회피', cluster: '-', body: a.body,
          score: `결측률 ${pct(a.missingRate)} · 응답 ${a.votes}표`, statementId: a.statementId
        })
      }
    }
    if (!ls.enabled) {
      land.addRow({ round: r.roundIndex, kind: '비활성', cluster: '-', body: ls.reasonText ?? '사유 미상', score: `참가자 ${ls.participantCount} / 유효 ${ls.eligibleCount}`, statementId: '-' })
      if (ls.permutation) {
        land.addRow({
          round: r.roundIndex, kind: '순열검정', cluster: '-', body: '무작위 기준선과 구분되지 않음',
          score: `관측 ${ls.permutation.observed.toFixed(3)} / 95th ${ls.permutation.threshold95.toFixed(3)} / p=${ls.permutation.pValue.toFixed(4)}`, statementId: '-'
        })
      }
      addAvoided()
      continue
    }
    land.addRow({
      round: r.roundIndex, kind: '진단', cluster: '-', body: `분석 발언 ${ls.analyzedStatementCount}건`,
      score: `설명분산 ${pct(ls.explainedVarianceRatio)}`, statementId: '-'
    })
    if (ls.permutation) {
      land.addRow({
        round: r.roundIndex, kind: '순열검정', cluster: '-', body: `통과 (${ls.permutation.iterations}회)`,
        score: `관측 ${ls.permutation.observed.toFixed(3)} / 95th ${ls.permutation.threshold95.toFixed(3)} / p=${ls.permutation.pValue.toFixed(4)}`, statementId: '-'
      })
    }
    for (const note of [ls.varianceWarning, ls.stabilityWarning]) {
      if (note) land.addRow({ round: r.roundIndex, kind: '경고', cluster: '-', body: note, score: '-', statementId: '-' })
    }
    for (const c of ls.clusters) {
      land.addRow({ round: r.roundIndex, kind: '그룹 규모', cluster: clusterLabel(c.id), body: `${c.size}명`, score: `실루엣 ${pct(ls.silhouette)}`, statementId: '-' })
    }
    for (const g of ls.gic) {
      const detail = g.perCluster.map((c) => `${clusterLabel(c.clusterId)} ${pct(c.agreeRate)} n=${c.votes}`).join(' · ')
      land.addRow({ round: r.roundIndex, kind: 'GIC 상위', cluster: '전체', body: g.body, score: `GIC(기하평균) ${g.score.toFixed(4)} · ${detail}`, statementId: g.statementId })
    }
    if (ls.representatives.length === 0) {
      land.addRow({
        round: r.roundIndex, kind: '대표 의견', cluster: '-',
        body: '이 그룹들을 뚜렷이 구분짓는 발언이 통계적으로 확인되지 않았습니다', score: 'FDR 보정 후 유의 0건', statementId: '-'
      })
    }
    for (const rep of ls.representatives) {
      land.addRow({
        round: r.roundIndex, kind: '대표 의견', cluster: clusterLabel(rep.clusterId), body: rep.body,
        score: `${rep.rank}순위 · 찬성 ${pct(rep.agreeRate)} · +${(rep.lift * 100).toFixed(1)}p · 보정 p=${rep.pAdjusted.toExponential(2)}`,
        statementId: rep.statementId
      })
    }
    addAvoided()
  }

  // 시트 4: 근거 유형 분포 (Q1 — 참가자 자기 태깅). 개인 단위 행 없음, 억제 그룹은 사유만.
  const evi = wb.addWorksheet('근거 유형 분포')
  evi.columns = [
    { header: '라운드', key: 'round', width: 8 },
    { header: '범위', key: 'scope', width: 18 },
    { header: '경험', key: 'experience', width: 10 },
    { header: '자료·출처', key: 'source', width: 12 },
    { header: '추정', key: 'estimate', width: 10 },
    { header: '미지정', key: 'unspecified', width: 10 },
    { header: '총 발언', key: 'total', width: 10 },
    { header: '비고', key: 'note', width: 46 }
  ]
  evi.addRow({ round: '-', scope: '안내', note: EVIDENCE_NOTE })
  for (const r of report.rounds) {
    const push = (scope: string, d: EvidenceKindDistribution) => {
      if (d.suppressed) {
        evi.addRow({ round: r.roundIndex, scope, experience: '', source: '', estimate: '', unspecified: '', total: '', note: EVIDENCE_SUPPRESSED_TEXT })
        return
      }
      evi.addRow({
        round: r.roundIndex, scope,
        experience: `${d.counts.experience} (${pct(d.ratios.experience)})`,
        source: `${d.counts.source} (${pct(d.ratios.source)})`,
        estimate: `${d.counts.estimate} (${pct(d.ratios.estimate)})`,
        unspecified: `${d.counts.unspecified} (${pct(d.ratios.unspecified)})`,
        total: d.total,
        note: d.total === 0 ? '집계 대상 발언 없음' : ''
      })
    }
    push('라운드 전체', r.evidenceKind.overall)
    for (const g of r.evidenceKind.byGroup) push(`그룹 ${g.groupId}`, g.distribution)
  }

  // 시트 (조건부): 검토가 필요한 주장 — 승인된 항목이 있을 때만 시트를 만든다.
  if (report.aiObservations.length > 0) {
    const ai = wb.addWorksheet('검토가 필요한 주장')
    ai.columns = [
      { header: '유형', key: 'kind', width: 16 },
      { header: '원 발언', key: 'statementBody', width: 50 },
      { header: '관찰(AI 초안)', key: 'body', width: 46 },
      { header: '제안 질문', key: 'question', width: 40 },
      { header: 'statementId', key: 'statementId', width: 16 },
      { header: 'roundId', key: 'roundId', width: 16 }
    ]
    ai.addRow({ kind: '안내', statementBody: AI_OBS_NOTE.replace(/\*\*/g, ''), body: '', question: '', statementId: '-', roundId: '-' })
    for (const o of report.aiObservations) {
      ai.addRow({
        kind: AI_OBS_KIND_LABEL[o.kind],
        statementBody: o.statementBody,
        body: o.body,
        question: o.suggestedQuestion,
        statementId: o.statementId,
        roundId: o.roundId ?? '-'
      })
    }
  }

  // 시트 5: moderation 내역
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

  // 시트 6: 원자료 (statement 별 집계 — k-익명 억제 반영)
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
