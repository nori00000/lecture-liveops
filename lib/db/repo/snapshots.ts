import { getStore, bumpRevision } from '../fixture/store'
import type { SituationSnapshotRow } from '../schema'

export const snapshots = {
  async latest(sessionId: string): Promise<SituationSnapshotRow | undefined> {
    return [...getStore().situation_snapshots]
      .filter((s) => s.session_id === sessionId)
      .sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0]
  },
  async upsert(row: SituationSnapshotRow): Promise<SituationSnapshotRow> {
    const s = getStore()
    s.situation_snapshots = [
      ...s.situation_snapshots.filter((x) => x.session_id !== row.session_id),
      row
    ]
    bumpRevision()
    return row
  }
}
