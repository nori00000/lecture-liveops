import Link from 'next/link'
import { Badge, Button, Card, CardHeader, PageHeader } from '@/components/ui/primitives'
import { SessionHtmlButton } from '@/components/liveops/SessionHtmlButton'
import { companies, exportJobs, sessions } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import type { ExportJob, Session } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'

type SessionRow = {
  session: Session
  companyName: string
  exports: ExportJob[]
}

export default async function SessionsArchivePage() {
  const ctx = adminContext()
  const [sessionRows, companyRows, jobRows] = await Promise.all([
    sessions.list(ctx),
    companies.list(ctx),
    exportJobs.list(ctx)
  ])
  const rows: SessionRow[] = sessionRows.map((session) => ({
    session,
    companyName: companyRows.find((c) => c.id === session.company_id)?.name ?? session.company_id,
    exports: jobRows.filter((j) => j.session_id === session.id)
  }))

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="세션 아카이브"
        desc="세션별 상황판 · 타임라인 · Markdown 백업을 한곳에서 다시 엽니다."
        right={<Link href="/sessions/new"><Button variant="accent">새 세션</Button></Link>}
      />
      <ArchiveSummary rows={rows} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {rows.map((row) => <SessionArchiveCard key={row.session.id} row={row} />)}
      </div>
      {rows.length === 0 ? (
        <Card className="p-6 text-sm text-textMute">저장된 세션이 없습니다.</Card>
      ) : null}
    </div>
  )
}

function ArchiveSummary({ rows }: { rows: SessionRow[] }) {
  const backups = rows.reduce((sum, row) => sum + row.exports.filter(isBackupJob).length, 0)
  const live = rows.filter((row) => row.session.mode === 'live').length
  return (
    <div className="grid grid-cols-3 gap-2">
      <Metric label="세션" value={`${rows.length}개`} />
      <Metric label="Live" value={`${live}개`} />
      <Metric label="백업" value={`${backups}개`} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] text-textMute">{label}</div>
      <div className="mt-1 text-lg font-semibold text-text">{value}</div>
    </Card>
  )
}

function SessionArchiveCard({ row }: { row: SessionRow }) {
  const { session } = row
  const backups = row.exports.filter(isBackupJob)
  const latestBackup = backups[0]
  return (
    <Card>
      <CardHeader title={session.title} hint={session.date} />
      <div className="p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={toneForMode(session.mode)}>{session.mode}</Badge>
          <span className="text-xs text-textMute">{row.companyName}</span>
          {session.venue ? <span className="text-xs text-textMute">· {session.venue}</span> : null}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Mini label="백업" value={`${backups.length}건`} />
          <Mini label="Export" value={`${row.exports.length}건`} />
          <Mini label="최근 백업" value={latestBackup ? formatDateTime(latestBackup.created_at) : '없음'} />
          <Mini label="Session ID" value={session.id} mono />
        </div>
        {latestBackup?.output_paths ? <BackupCounts job={latestBackup} /> : null}
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href={`/sessions/${session.id}`}><Button size="sm">상황판</Button></Link>
          <Link href={`/sessions/${session.id}/timeline`}><Button size="sm">타임라인</Button></Link>
          <Link href={`/sessions/${session.id}/export`}><Button size="sm" variant="accent">MD 보기</Button></Link>
          <SessionHtmlButton sessionId={session.id} />
        </div>
      </div>
    </Card>
  )
}

function Mini({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded border border-border bg-bg/70 p-2 min-w-0">
      <div className="text-textMute">{label}</div>
      <div className={`mt-1 truncate text-text ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  )
}

function BackupCounts({ job }: { job: ExportJob }) {
  const counts = readCounts(job)
  if (!counts) return null
  return (
    <div className="rounded border border-accentDim/30 bg-accentDim/10 p-2 text-xs text-textDim">
      최근 백업 항목: 질문 {counts.qna ?? 0} · 실습 {counts.practice ?? 0} · 운영 {counts.ops ?? 0} · 좌석 {counts.seatMarks ?? 0}
    </div>
  )
}

function isBackupJob(job: ExportJob): boolean {
  return job.output_paths.backup === true || job.output_paths.kind === 'session_backup'
}

function readCounts(job: ExportJob): Record<string, number> | null {
  const counts = job.output_paths.counts
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) return null
  return counts as Record<string, number>
}

function toneForMode(mode: Session['mode']) {
  if (mode === 'live') return 'accent' as const
  if (mode === 'archived') return 'neutral' as const
  if (mode === 'prep') return 'info' as const
  return 'warn' as const
}

function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}
