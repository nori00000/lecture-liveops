import { z } from 'zod'
import path from 'node:path'
import os from 'node:os'
import { exportJobs, externalArchives, sessions, companies, courses, qna, practice, opsLogs, resources, signals, seatMarks } from '@/lib/db/repo'
import { planMarkdownExport } from '@/lib/export/markdown'
import { isArchivePathBlocked, buildArchiveTargetPath } from '@/lib/export/archive-target'
import { envelopeToCtx } from '../context'
import { onExportCompleted } from '@/lib/notify/hooks'
import type { Handler } from './types'

const ExportInput = z.object({
  sessionId: z.string(),
  formats: z.array(z.enum(['md', 'xlsx', 'pdf', 'html', 'image', 'link'])).default(['md']),
  profile: z.enum(['internal_retro', 'company_deliverable', 'participant_share', 'markdown_archive']).default('internal_retro'),
  backup: z.boolean().default(false)
})

export const exportSessionArchive: Handler = async ({ envelope }) => {
  const input = ExportInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const dry = envelope.dryRun
  const plan = await planMarkdownExport(ctx, input.sessionId)
  const counts = input.backup ? await sessionBackupCounts(ctx, input.sessionId) : undefined
  const job = await exportJobs.insert(ctx, {
    session_id: input.sessionId,
    profile: input.profile,
    formats: input.formats,
    status: dry ? 'queued' : 'completed',
    output_paths: {
      plan: plan.map((f) => f.name),
      dry_run: dry,
      backup: input.backup,
      kind: input.backup ? 'session_backup' : 'session_export',
      sessionId: input.sessionId,
      generatedAt: new Date().toISOString(),
      ...(counts ? { counts } : {})
    }
  })
  // dry-run은 알림 발송 안 함 (실제 결과 없으므로). 실 export만 알림.
  if (!dry) {
    void onExportCompleted({ sessionId: input.sessionId, profile: input.profile, formats: input.formats })
  }
  return {
    data: { jobId: job.id, dryRun: dry, backup: input.backup, files: plan.map((f) => f.name), profile: input.profile, formats: input.formats, counts },
    summary: `export ${input.profile} formats=${input.formats.length} files=${plan.length} dry=${dry}`
  }
}

const ArchiveTargetInput = z.object({
  sessionId: z.string(),
  targetPath: z.string().optional(),
  profile: z.enum(['markdown_archive', 'internal_retro']).default('markdown_archive')
})

export const syncExternalArchive: Handler = async ({ envelope }) => {
  const input = ArchiveTargetInput.parse(envelope.input)
  const ctx = envelopeToCtx(envelope)
  const session = await sessions.findById(ctx, input.sessionId)
  if (!session) throw new Error('session not found')
  const [company, course] = await Promise.all([
    companies.findById(ctx, session.company_id),
    courses.findById(ctx, session.course_id)
  ])
  const target = input.targetPath
    ?? buildArchiveTargetPath({
      companyName: company?.name ?? 'unknown',
      sessionDate: session.date,
      courseTitle: course?.title ?? session.title
    })
  if (isArchivePathBlocked(target)) {
    const arc = await externalArchives.insert(ctx, { session_id: session.id, target_path: target, status: 'blocked', frontmatter: {} })
    return { data: { archiveId: arc.id, status: 'blocked', target }, summary: `external archive blocked ${target}` }
  }
  const plan = await planMarkdownExport(ctx, session.id)
  const archive = await externalArchives.insert(ctx, {
    session_id: session.id,
    target_path: target,
    status: 'dry_run',
    frontmatter: { profile: input.profile, files: plan.map((f) => f.name) }
  })
  return {
    data: {
      archiveId: archive.id,
      status: 'dry_run',
      target,
      files: plan.map((f) => f.name),
      note: '실제 .md 파일 쓰기는 사용자 명시 --apply 게이트 후 진행'
    },
    summary: `external archive dry_run ${path.basename(target)}`
  }
}

export function homeBase(): string {
  return os.homedir()
}

async function sessionBackupCounts(ctx: ReturnType<typeof envelopeToCtx>, sessionId: string) {
  const [qnaRows, ptRows, opRows, rsRows, sigRows, seatRows] = await Promise.all([
    qna.list(ctx, sessionId),
    practice.list(ctx, sessionId),
    opsLogs.list(ctx, sessionId),
    resources.list(ctx, sessionId),
    signals.list(ctx, sessionId),
    seatMarks.list(ctx, sessionId)
  ])
  return {
    qna: qnaRows.length,
    practice: ptRows.length,
    ops: opRows.length,
    resources: rsRows.length,
    signals: sigRows.length,
    seatMarks: seatRows.length,
    seatProblems: seatRows.filter((m) => m.status === 'problem').length
  }
}
