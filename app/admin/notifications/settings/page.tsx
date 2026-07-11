import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { getNeonOwnerSql } from '@/lib/db/neon'

export const dynamic = 'force-dynamic'

type Row = { id: string; event_type: string; channel: string; enabled: boolean }

async function loadSettings(): Promise<Row[]> {
  const sql = getNeonOwnerSql()
  const rows = (await sql`select id, event_type, channel, enabled from notify_settings where session_id is null order by event_type, channel`) as Row[]
  return rows
}

async function toggleAction(formData: FormData) {
  'use server'
  const id = String(formData.get('id') ?? '')
  const next = String(formData.get('next') ?? 'false') === 'true'
  if (!id) return
  const sql = getNeonOwnerSql()
  await sql`update notify_settings set enabled = ${next}, updated_at = now() where id = ${id}`
}

export default async function NotifySettingsPage() {
  const session = await auth()
  if (!session?.user) redirect('/admin/login')
  const rows = await loadSettings()
  const byEvent = new Map<string, Row[]>()
  for (const r of rows) {
    if (!byEvent.has(r.event_type)) byEvent.set(r.event_type, [])
    byEvent.get(r.event_type)!.push(r)
  }
  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">알림 설정</h1>
      <p className="text-sm text-textDim mb-6">
        이벤트마다 채널을 켜고 끌 수 있습니다. (전역 기본값. 세션별 override는 추후)
      </p>
      <div className="space-y-4">
        {Array.from(byEvent.entries()).map(([event, channels]) => (
          <div key={event} className="bg-surface border border-border rounded p-4">
            <div className="text-sm font-medium mb-2">{eventLabel(event)}</div>
            <div className="flex flex-wrap gap-3">
              {channels.map((c) => (
                <form key={c.id} action={toggleAction} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={c.id} />
                  <input type="hidden" name="next" value={String(!c.enabled)} />
                  <button
                    type="submit"
                    className={
                      'px-3 py-1.5 text-xs rounded border transition-colors ' +
                      (c.enabled
                        ? 'bg-accentDim border-accent text-text'
                        : 'bg-surfaceAlt border-border text-textDim hover:text-text')
                    }
                  >
                    {channelLabel(c.channel)} {c.enabled ? 'ON' : 'OFF'}
                  </button>
                </form>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function eventLabel(e: string): string {
  switch (e) {
    case 'access_key_issued': return '접속 코드 발급'
    case 'qna_answered': return '질문 답변 등록'
    case 'signal_raised': return '운영 신호 발생'
    case 'export_completed': return '아카이브 생성 완료'
    case 'practice_ticket_critical': return '실습 지원 (긴급)'
    default: return e
  }
}

function channelLabel(c: string): string {
  switch (c) {
    case 'email': return '이메일'
    case 'sms': return 'SMS'
    default: return c
  }
}
