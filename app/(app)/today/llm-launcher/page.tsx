'use client'

import { useEffect, useState } from 'react'
import { Card, CardHeader, Badge, Button, PageHeader, Select, Textarea } from '@/components/ui/primitives'
import { apiFetch } from '@/lib/api/fetcher'

// fallback 전용 — 실제 목록은 마운트 시 GET /api/action catalog로 동적 로드
const FALLBACK_ACTIONS = [
  'liveops.get_today_session',
  'liveops.add_qna',
  'liveops.answer_qna',
  'liveops.update_qna_status',
  'liveops.create_practice_ticket',
  'liveops.update_practice_ticket',
  'liveops.upload_resource',
  'liveops.attach_link',
  'liveops.append_ops_log',
  'liveops.send_assistant_signal',
  'liveops.update_table_status',
  'liveops.open_collaborative_excel',
  'liveops.update_excel_cell',
  'liveops.export_session_archive',
  'liveops.preview_archive_target'
]

const ROLES = ['admin', 'instructor', 'assistant', 'participant']

export default function LlmLauncherPage() {
  const [actions, setActions] = useState<string[]>(FALLBACK_ACTIONS)
  const [action, setAction] = useState(FALLBACK_ACTIONS[0])
  const [role, setRole] = useState('admin')
  const [dryRun, setDryRun] = useState(true)
  const [tool, setTool] = useState('claude-code')
  const [inputText, setInputText] = useState('{\n  "date": "2026-05-27"\n}')
  const [result, setResult] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/action', { cache: 'no-store' })
      .then((res) => res.json())
      .then((body: { ok?: boolean; catalog?: unknown }) => {
        if (cancelled || !body?.ok || !Array.isArray(body.catalog) || body.catalog.length === 0) return
        const catalog = body.catalog.filter((a): a is string => typeof a === 'string')
        if (catalog.length > 0) setActions(catalog)
      })
      .catch(() => {
        // catalog fetch 실패 시 하드코딩 fallback 유지
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function send() {
    let input: unknown = {}
    try {
      input = JSON.parse(inputText)
    } catch (e) {
      setResult('JSON 파싱 실패: ' + String(e))
      return
    }
    const envelope = {
      action,
      actor: { type: 'llm', role, tool },
      scope: {},
      idempotencyKey: crypto.randomUUID(),
      redactionPolicy: 'summary',
      dryRun,
      input
    }
    const res = await apiFetch('/api/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope)
    })
    const body = await res.json()
    setResult(JSON.stringify(body, null, 2))
  }

  return (
    <div className="p-6">
      <PageHeader
        title="LLM 런처"
        desc="LLM/Claude Code/Codex/MCP가 UI 구조를 바꾸지 않고 action contract로만 사이트를 조작"
        right={<Badge tone={dryRun ? 'info' : 'warn'}>{dryRun ? 'dry-run' : 'live'}</Badge>}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader title="envelope 구성" />
          <div className="p-4 space-y-3">
            <Row label="action">
              <Select value={action} onChange={(e) => setAction(e.target.value)}>
                {actions.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
            </Row>
            <Row label="actor.role">
              <Select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Row>
            <Row label="actor.tool">
              <Select value={tool} onChange={(e) => setTool(e.target.value)}>
                {['claude-code', 'codex', 'opencode', 'mcp', 'web-ui'].map((t) => <option key={t} value={t}>{t}</option>)}
              </Select>
            </Row>
            <Row label="dryRun">
              <label className="text-sm text-text inline-flex items-center gap-2">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                기본 ON. 실제 실행은 의도적으로만.
              </label>
            </Row>
            <Row label="input JSON">
              <Textarea rows={10} value={inputText} onChange={(e) => setInputText(e.target.value)} className="font-mono text-xs" />
            </Row>
            <div className="pt-1">
              <Button variant="accent" onClick={send}>호출</Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="결과" />
          <pre className="p-4 text-xs font-mono whitespace-pre-wrap text-textDim min-h-[280px]">{result || '아직 호출 결과 없음'}</pre>
        </Card>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-textDim mb-1">{label}</div>
      {children}
    </div>
  )
}
