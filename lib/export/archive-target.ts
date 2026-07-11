import fs from 'node:fs'
import path from 'node:path'
import { planMarkdownExport } from './markdown'

const PROTECTED_SEGMENTS = ['.git', 'node_modules', '.env']

export function isArchivePathBlocked(targetPath: string): boolean {
  const normalized = path.resolve(targetPath)
  return normalized.split(path.sep).some((part) => PROTECTED_SEGMENTS.includes(part))
}

export function buildArchiveTargetPath(input: { companyName: string; sessionDate: string; courseTitle: string }): string {
  const safe = (value: string) => value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)
  return path.join(process.cwd(), 'exports', safe(input.companyName), `${input.sessionDate}-${safe(input.courseTitle)}`)
}

export type ArchiveDryRunReport = {
  status: 'dry_run' | 'blocked' | 'applied'
  target: string
  files: string[]
  skipped: string[]
  message: string
}

export async function dryRunArchiveExport(sessionId: string, target: string): Promise<ArchiveDryRunReport> {
  if (isArchivePathBlocked(target)) {
    return { status: 'blocked', target, files: [], skipped: [], message: '보호 경로와 겹쳐 차단되었습니다.' }
  }
  const { adminContext } = await import('../db/neonHelpers')
  const plan = await planMarkdownExport(adminContext(sessionId), sessionId)
  const files = plan.filter((file) => !fs.existsSync(path.join(target, file.name))).map((file) => file.name)
  const skipped = plan.filter((file) => fs.existsSync(path.join(target, file.name))).map((file) => file.name)
  return { status: 'dry_run', target, files, skipped, message: `dry-run: ${files.length}개 생성 예정, ${skipped.length}개 기존 파일 보존` }
}
