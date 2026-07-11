import { qna, practice, opsLogs, resources, sessions, companies, courses, signals, seatMarks } from '@/lib/db/repo'
import type { Qna, PracticeTicket, OpsLog, Resource, AssistantSignal, SeatMark } from '@/lib/db/schema'
import type { RlsContext } from '@/lib/db/neonHelpers'

export type ExportFile = { name: string; content: string }

export async function planMarkdownExport(ctx: RlsContext, sessionId: string): Promise<ExportFile[]> {
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return []
  const [company, course, qnaRows, ptRows, opRows, rsRows, sigRows, seatRows] = await Promise.all([
    companies.findById(ctx, session.company_id),
    courses.findById(ctx, session.course_id),
    qna.list(ctx, sessionId),
    practice.list(ctx, sessionId),
    opsLogs.list(ctx, sessionId),
    resources.list(ctx, sessionId),
    signals.list(ctx, sessionId),
    seatMarks.list(ctx, sessionId)
  ])

  const timeline = buildTimeline({ qnaRows, ptRows, opRows, rsRows, sigRows, seatRows })

  // dangling FK(회사/강좌 미연결, 과거 DEMO 오참조 등)면 빈값 대신 경고를 남겨 운영자가 인지하게 한다.
  const companyName = company?.name ?? `(⚠ 회사 미연결: ${session.company_id})`
  const courseTitle = course?.title ?? `(⚠ 강좌 미연결: ${session.course_id})`

  const fm = (type: string, status: string) =>
    [
      '---',
      `type: ${type}`,
      `project: 기업AX교육`,
      `company: ${companyName}`,
      `course: ${courseTitle}`,
      `session: ${session.title}`,
      `date: ${session.date}`,
      `status: ${status}`,
      `tags: [ax-liveops, ${type}]`,
      `source: ax-liveops/${session.id}`,
      '---',
      ''
    ].join('\n')

  const toc = (headings: string[]) =>
    '## 목차\n' + headings.map((h) => `- [[#${h}|${h}]]`).join('\n') + '\n'

  const mocHeads = ['세션 개요', '연결 노트']
  const moc =
    fm('moc', 'live') +
    `# ${course?.title ?? session.title} — MOC\n\n` +
    toc(mocHeads) +
    `\n### ${mocHeads[0]}\n- 기업: ${companyName}\n- 강의: ${courseTitle}\n- 세션: ${session.title} (${session.date})\n\n` +
    `### ${mocHeads[1]}\n- [[01-세션-요약]]\n- [[02-QnA-아카이브]]\n- [[03-실습-티켓]]\n- [[04-운영-로그]]\n- [[05-자료-인덱스]]\n- [[06-세션-타임라인]]\n`

  const sumHeads = ['핵심 지표', '하루 흐름']
  const summary =
    fm('session-summary', 'snapshot') +
    `# ${session.title} 요약\n\n` +
    toc(sumHeads) +
    `\n### ${sumHeads[0]}\n- 질문 ${qnaRows.length}건 (미답 ${qnaRows.filter((q) => q.status !== 'answered' && q.status !== 'sent_to_company').length})\n- 실습 티켓 ${ptRows.length}건 (해결 ${ptRows.filter((p) => p.status === 'solved').length})\n- 운영 로그 ${opRows.length}건\n- 운영 신호 ${sigRows.length}건\n- 좌석 마크 ${seatRows.length}건 (문제 ${seatRows.filter((m) => m.status === 'problem').length}건)\n- 자료 ${rsRows.length}건\n\n` +
    `### ${sumHeads[1]}\n` +
    opRows.slice(-10).reverse().map((o) => `- ${o.created_at.slice(11, 16)} ${o.type}: ${o.body}`).join('\n') +
    '\n'

  const qnaHeads = ['답변 완료', '미답/팔로업']
  const answered = qnaRows.filter((q) => q.status === 'answered' || q.status === 'sent_to_company')
  const pending = qnaRows.filter((q) => q.status !== 'answered' && q.status !== 'sent_to_company')
  const qnaDoc =
    fm('qna-archive', 'snapshot') +
    `# 질문답변 아카이브\n\n` +
    toc(qnaHeads) +
    `\n### ${qnaHeads[0]}\n` +
    answered.map((q) => `- **Q.** ${q.body}\n  - **A.** ${q.answer ?? '(답변 없음)'}`).join('\n') +
    `\n\n### ${qnaHeads[1]}\n` +
    pending.map((q) => `- ${q.body} (상태: ${q.status})`).join('\n') +
    '\n'

  const ptHeads = ['전체 티켓']
  const ptDoc =
    fm('practice-archive', 'snapshot') +
    `# 실습 티켓 아카이브\n\n` +
    toc(ptHeads) +
    `\n### ${ptHeads[0]}\n` +
    ptRows.map((p) => `- [${p.table_label || '미지정'}] ${p.body} (${p.status}, ${p.severity})`).join('\n') +
    '\n'

  const opsHeads = ['시간 순']
  const opsDoc =
    fm('ops-log', 'snapshot') +
    `# 운영 로그\n\n` +
    toc(opsHeads) +
    `\n### ${opsHeads[0]}\n` +
    opRows.map((o) => `- ${o.created_at.slice(0, 16).replace('T', ' ')} [${o.type}] ${o.body}`).join('\n') +
    '\n'

  const rsHeads = ['자료 인덱스']
  const rsDoc =
    fm('resource-index', 'snapshot') +
    `# 자료 인덱스\n\n` +
    toc(rsHeads) +
    `\n### ${rsHeads[0]}\n` +
    rsRows.map((r) => `- (${r.type}) ${r.title} — 공개범위 ${r.visibility}`).join('\n') +
    '\n'

  const timelineHeads = ['전체 흐름']
  const timelineDoc =
    fm('session-timeline', 'snapshot') +
    `# 세션 타임라인\n\n` +
    toc(timelineHeads) +
    `\n### ${timelineHeads[0]}\n` +
    timeline.map((e) => `- ${e.time} [${e.kind}] ${e.body}`).join('\n') +
    '\n'

  return [
    { name: '00-MOC-인덱스.md', content: moc },
    { name: '01-세션-요약.md', content: summary },
    { name: '02-QnA-아카이브.md', content: qnaDoc },
    { name: '03-실습-티켓.md', content: ptDoc },
    { name: '04-운영-로그.md', content: opsDoc },
    { name: '05-자료-인덱스.md', content: rsDoc },
    { name: '06-세션-타임라인.md', content: timelineDoc }
  ]
}

type TimelineInput = {
  qnaRows: Qna[]
  ptRows: PracticeTicket[]
  opRows: OpsLog[]
  rsRows: Resource[]
  sigRows: AssistantSignal[]
  seatRows: SeatMark[]
}

type TimelineEntry = { at: string; time: string; kind: string; body: string }

function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...input.qnaRows.map((q) => entry(q.created_at, '질문', q.body)),
    ...input.ptRows.map((p) => entry(p.created_at, '실습', `[${p.table_label || '미지정'}] ${p.body} (${p.status})`)),
    ...input.opRows.map((o) => entry(o.created_at, `운영/${o.type}`, o.body)),
    ...input.rsRows.map((r) => entry(r.created_at, '자료', `${r.title} (${r.type})`)),
    ...input.sigRows.map((s) => entry(s.created_at, '신호', `${s.signal_type}${s.table_label ? ` · ${s.table_label}` : ''}${s.note ? ` — ${s.note}` : ''}`)),
    ...input.seatRows.map((m) => entry(m.updated_at, '좌석', `${m.seat_key} ${m.status}${m.reason ? ` · ${m.reason}` : ''}${m.memo ? ` — ${m.memo}` : ''}`))
  ]
  return entries.sort((a, b) => a.at.localeCompare(b.at))
}

function entry(at: string, kind: string, body: string): TimelineEntry {
  return { at, kind, body, time: at.slice(0, 16).replace('T', ' ') }
}

