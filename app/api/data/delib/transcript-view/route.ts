import { NextResponse } from 'next/server'
import { delibGroups, delibRounds, sessions, statements, transcripts } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { readRecordingConsent } from '@/lib/action/handlers/delib'
import { buildTranscriptLensSummary, type TranscriptLensSegmentInput } from '@/lib/delib/transcriptLens'
import { gateTranscriptSources } from '@/lib/dialogue/access'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const [groups, rounds, allSources, visibleStatements] = await Promise.all([
    delibGroups.list(ctx, sessionId),
    delibRounds.list(ctx, sessionId),
    transcripts.listSources(ctx, sessionId),
    statements.list(ctx, sessionId, undefined, { visibleOnly: true })
  ])
  // C2: 전사 원문 read 는 동의 게이트 통과 후에만 (dialogue live/projector 와 동일 helper).
  // 이 라우트는 운영자 전용이지만 동의 철회의 의미는 "아무 화면에도 안 뜬다" 이므로 예외를 두지 않는다.
  const recording = readRecordingConsent(session.metadata)
  const sources = gateTranscriptSources(recording.active, allSources)
  const sourceSegments = sources.length > 0
    ? await transcripts.listSegmentsBySourceIds(ctx, sources.map((s) => s.id), { limit: 120 })
    : []
  const groupById = new Map(groups.map((g) => [g.id, g] as const))
  const sourceById = new Map(sources.map((s) => [s.id, s] as const))

  const transcriptSegments: TranscriptLensSegmentInput[] = sourceSegments.map((s) => {
    const source = sourceById.get(s.source_id)
    return {
      id: s.id,
      sourceId: s.source_id,
      groupId: source?.group_id ?? null,
      roundId: s.round_id,
      speakerTag: s.speaker_tag || source?.device_label || 'speaker',
      startedMs: s.started_ms,
      endedMs: s.ended_ms,
      text: s.text,
      confidence: s.confidence,
      createdAt: s.created_at
    }
  })

  const activeRound = rounds.find((r) => r.status === 'active') ?? null
  const previewSourceId = `preview:${sessionId}`
  const previewSegments: TranscriptLensSegmentInput[] = visibleStatements
    .slice(-80)
    .map((s, index) => ({
      id: `preview:${s.id}`,
      sourceId: previewSourceId,
      groupId: s.group_id,
      roundId: s.round_id,
      speakerTag: s.group_id ? (groupById.get(s.group_id)?.label ?? '그룹') : '전체',
      startedMs: index * 12_000,
      endedMs: index * 12_000 + 8_000,
      text: s.body,
      confidence: null,
      createdAt: s.created_at
    }))

  const mode = transcriptSegments.length > 0 ? 'transcript' : 'statement_preview'
  const lensSegments = mode === 'transcript' ? transcriptSegments : previewSegments
  const recentSegments = lensSegments.slice(-30)
  const summary = buildTranscriptLensSummary(lensSegments, groups.map((g) => ({ id: g.id, label: g.label })))
  const lastUpdatedAt = lensSegments.reduce<string | null>((max, s) => (max == null || s.createdAt > max ? s.createdAt : max), null)

  return NextResponse.json({
    ok: true,
    mode,
    modeLabel: mode === 'transcript' ? '전사 연결됨' : '전사 미연결 프리뷰',
    session: { id: session.id, title: session.title, date: session.date },
    activeRound: activeRound ? { id: activeRound.id, roundIndex: activeRound.round_index, title: activeRound.title } : null,
    recording: {
      active: recording.active,
      consentAt: recording.consentAt,
      offsiteProcessing: recording.offsiteProcessing
    },
    coverage: {
      sourceCount: mode === 'transcript' ? sources.length : 0,
      segmentCount: lensSegments.length,
      visibleSegmentCount: recentSegments.length,
      lastUpdatedAt
    },
    sources: mode === 'transcript'
      ? sources.map((s) => ({
        id: s.id,
        groupId: s.group_id,
        deviceLabel: s.device_label,
        label: s.group_id ? `${groupById.get(s.group_id)?.label ?? '그룹'} · ${s.device_label || '녹음 장치'}` : (s.device_label || '녹음 장치')
      }))
      : [{ id: previewSourceId, groupId: null, deviceLabel: 'statement preview', label: '제출 발언 프리뷰' }],
    segments: recentSegments,
    keywords: summary.keywords,
    groupActivity: summary.groupActivity,
    pulse: summary.pulse
  })
}
