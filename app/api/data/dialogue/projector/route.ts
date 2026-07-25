import { NextResponse } from 'next/server'
import { delibGroups, delibRounds, sessions, statements, transcripts } from '@/lib/db/repo'
import { adminContext } from '@/lib/db/neonHelpers'
import { readRecordingConsent } from '@/lib/action/handlers/delib'
import { buildTranscriptLensSummary, type TranscriptLensSegmentInput } from '@/lib/delib/transcriptLens'
import { buildDialogueStateMap, type DialogueMirrorSegment } from '@/lib/dialogue/stateMap'
import { buildDialogueNudges } from '@/lib/dialogue/nudges'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId')
  if (!sessionId) return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 })

  const ctx = adminContext(sessionId)
  const session = await sessions.findById(ctx, sessionId)
  if (!session) return NextResponse.json({ ok: false, error: 'session not found' }, { status: 404 })

  const [groups, rounds, sources, visibleStatements] = await Promise.all([
    delibGroups.list(ctx, sessionId),
    delibRounds.list(ctx, sessionId),
    transcripts.listSources(ctx, sessionId),
    statements.list(ctx, sessionId, undefined, { visibleOnly: true })
  ])
  const sourceSegments = await transcripts.listSegmentsBySourceIds(ctx, sources.map((s) => s.id), { limit: 160 })
  const sourceById = new Map(sources.map((s) => [s.id, s] as const))
  const groupById = new Map(groups.map((g) => [g.id, g] as const))
  const activeRound = rounds.find((r) => r.status === 'active') ?? null

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
  const previewSegments: TranscriptLensSegmentInput[] = visibleStatements.slice(-100).map((s, index) => ({
    id: `preview:${s.id}`,
    sourceId: `preview:${sessionId}`,
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
  const recentSegments = lensSegments.slice(-12).map((s, index) => ({
    id: `segment:${index}`,
    speakerTag: s.speakerTag,
    startedMs: s.startedMs,
    text: s.text
  }))
  const summary = buildTranscriptLensSummary(lensSegments, groups.map((g) => ({ id: g.id, label: g.label })), { keywordLimit: 10 })
  const mirrorSegments: DialogueMirrorSegment[] = lensSegments.map((s) => ({
    id: s.id,
    groupId: s.groupId,
    speakerTag: s.speakerTag,
    startedMs: s.startedMs,
    text: s.text,
    createdAt: s.createdAt
  }))
  const mirror = buildDialogueStateMap(mirrorSegments)
  const nudges = buildDialogueNudges(mirror)
  const recording = readRecordingConsent(session.metadata)

  return NextResponse.json({
    ok: true,
    mode,
    modeLabel: mode === 'transcript' ? '전사 연결됨' : '전사 미연결 프리뷰',
    session: { id: session.id, title: session.title, date: session.date },
    activeRound: activeRound ? { id: activeRound.id, roundIndex: activeRound.round_index, title: activeRound.title } : null,
    recording: { active: recording.active, consentAt: recording.consentAt },
    segments: recentSegments,
    pulse: summary.pulse,
    keywords: summary.keywords,
    mirror: {
      openQuestions: mirror.openQuestions.slice(0, 4).map((q, index) => ({
        id: `question:${index}`,
        text: q.text,
        prompt: q.prompt,
        status: q.status
      })),
      conceptThreads: mirror.conceptThreads.filter((c) => c.posture === 'needs_definition').slice(0, 4).map((c) => ({
        term: c.term,
        prompt: c.prompt,
        contexts: c.contexts
      })),
      tensionAxes: mirror.tensionAxes.slice(0, 3).map((a) => ({
        id: a.id,
        label: a.label,
        left: a.left,
        right: a.right,
        leftCount: a.leftCount,
        rightCount: a.rightCount,
        prompt: a.prompt
      })),
      commonGround: mirror.commonGround.slice(0, 4).map((g, index) => ({
        id: `ground:${index}`,
        label: g.label,
        prompt: g.prompt,
        mentionCount: g.segmentIds.length
      })),
      hygiene: mirror.hygiene
    },
    nudges: nudges.projector.slice(0, 5).map((n, index) => ({
      id: `nudge:${index}`,
      kind: n.kind,
      label: n.label,
      prompt: n.prompt,
      priority: n.priority
    }))
  })
}
