// Lecture LiveOps — transcript read repo.
// This is intentionally read-only for now: capture/STT ingest remains a separate gated integration.

import { getStore } from '../fixture/store'
import { isNeonEnabled } from '../neon'
import { query, COLS, isoOrString, type RlsContext } from '../neonHelpers'
import type { TranscriptInsight, TranscriptInsightKind, TranscriptInsightStatus, TranscriptSegment, TranscriptSource } from '../schema'

type Row = Record<string, unknown>

function toSource(r: Row): TranscriptSource {
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    group_id: r.group_id == null ? null : String(r.group_id),
    device_label: String(r.device_label ?? ''),
    started_at: isoOrString(r.started_at),
    ended_at: r.ended_at == null ? null : isoOrString(r.ended_at),
    consent_confirmed_at: r.consent_confirmed_at == null ? null : isoOrString(r.consent_confirmed_at),
    created_at: isoOrString(r.created_at)
  }
}

function toSegment(r: Row): TranscriptSegment {
  return {
    id: String(r.id),
    source_id: String(r.source_id),
    round_id: r.round_id == null ? null : String(r.round_id),
    speaker_tag: String(r.speaker_tag ?? ''),
    started_ms: Number(r.started_ms ?? 0),
    ended_ms: Number(r.ended_ms ?? 0),
    text: String(r.text ?? ''),
    confidence: r.confidence == null ? null : Number(r.confidence),
    created_at: isoOrString(r.created_at)
  }
}

function toInsight(r: Row): TranscriptInsight {
  const ids = r.evidence_segment_ids
  return {
    id: String(r.id),
    session_id: String(r.session_id),
    round_id: r.round_id == null ? null : String(r.round_id),
    group_id: r.group_id == null ? null : String(r.group_id),
    body: String(r.body ?? ''),
    kind: (r.kind as TranscriptInsightKind) ?? 'other',
    evidence_segment_ids: Array.isArray(ids) ? ids.map(String) : [],
    status: (r.status as TranscriptInsightStatus) ?? 'pending',
    promoted_statement_id: r.promoted_statement_id == null ? null : String(r.promoted_statement_id),
    created_at: isoOrString(r.created_at)
  }
}

export const transcripts = {
  async listSources(ctx: RlsContext, sessionId: string): Promise<TranscriptSource[]> {
    if (isNeonEnabled()) {
      const rows = await query(ctx, `select ${COLS.transcript_sources} from transcript_sources where session_id = $1 order by started_at asc, id asc`, [sessionId])
      return rows.map(toSource)
    }
    return getStore()
      .transcript_sources
      .filter((s) => s.session_id === sessionId)
      .slice()
      .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id.localeCompare(b.id))
  },

  async listSegmentsBySourceIds(ctx: RlsContext, sourceIds: string[], opts: { limit?: number } = {}): Promise<TranscriptSegment[]> {
    const ids = Array.from(new Set(sourceIds))
    if (ids.length === 0) return []
    const limit = Math.max(1, Math.min(opts.limit ?? 120, 500))
    if (isNeonEnabled()) {
      const rows = await query(
        ctx,
        `select ${COLS.transcript_segments} from transcript_segments where source_id = any($1) order by started_ms desc, created_at desc, id desc limit $2`,
        [ids, limit]
      )
      return rows.map(toSegment).sort((a, b) => a.started_ms - b.started_ms || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    }
    return getStore()
      .transcript_segments
      .filter((s) => ids.includes(s.source_id))
      .slice()
      .sort((a, b) => b.started_ms - a.started_ms || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .sort((a, b) => a.started_ms - b.started_ms || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  },

  async listInsights(ctx: RlsContext, sessionId: string, opts: { status?: TranscriptInsightStatus } = {}): Promise<TranscriptInsight[]> {
    if (isNeonEnabled()) {
      if (opts.status) {
        const rows = await query(ctx, `select ${COLS.transcript_insights} from transcript_insights where session_id = $1 and status = $2 order by created_at asc, id asc`, [sessionId, opts.status])
        return rows.map(toInsight)
      }
      const rows = await query(ctx, `select ${COLS.transcript_insights} from transcript_insights where session_id = $1 order by created_at asc, id asc`, [sessionId])
      return rows.map(toInsight)
    }
    return getStore()
      .transcript_insights
      .filter((i) => i.session_id === sessionId && (opts.status ? i.status === opts.status : true))
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  }
}
