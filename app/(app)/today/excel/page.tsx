'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { invoke } from '@/lib/util/envelope'
import { Card, CardHeader, Button, PageHeader, Select } from '@/components/ui/primitives'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then((r) => r.json())

type Cell = { id: string; cell_ref: string; value: string; updated_by: string; updated_at: string }

export default function ExcelPage() {
  const { data: sessionData } = useSWR<{ session?: { id: string }; excel_templates?: { id: string; title: string }[] }>('/api/data/session', fetcher, { refreshInterval: 5000 })
  const session = sessionData?.session
  const templates = useMemo(() => sessionData?.excel_templates ?? [], [sessionData])
  const [templateId, setTemplateId] = useState<string>('')
  useEffect(() => {
    if (!templateId && templates[0]) setTemplateId(templates[0].id)
  }, [templates, templateId])
  const { data: cellData, mutate } = useSWR<{ cells?: Cell[] }>(
    templateId ? `/api/data/excel?templateId=${templateId}` : null,
    fetcher,
    { refreshInterval: 2000 }
  )

  const grid = useMemo(() => buildGrid(cellData?.cells ?? []), [cellData?.cells])
  const [error, setError] = useState<string | null>(null)

  // 운영 콘솔 페이지이므로 participant가 아니라 assistant role로 invoke한다 (seatmap/playbook과 동일 패턴).
  async function setCell(cellRef: string, value: string) {
    if (!session || !templateId) return
    try {
      const res = await invoke({
        action: 'liveops.update_excel_cell',
        role: 'assistant',
        scope: { sessionId: session.id },
        input: { sessionId: session.id, templateId, sheetName: 'Sheet1', cellRef, value }
      })
      if (!res?.ok) {
        setError(`셀 ${cellRef} 저장에 실패했습니다: ${res?.error ?? res?.status ?? '알 수 없는 오류'}`)
        return
      }
      setError(null)
      mutate()
    } catch {
      setError(`셀 ${cellRef} 저장 요청 중 오류가 발생했습니다. 네트워크 상태를 확인해 주세요.`)
    }
  }

  return (
    <div className="p-6">
      <PageHeader title="협업 템플릿" desc="셀 단위 실시간 동기화 (fixture mode = 2초 polling)" />
      {error ? (
        <div role="status" className="mb-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      ) : null}
      <Card className="p-3 mb-4 flex items-center gap-2">
        <span className="text-xs text-textDim">템플릿</span>
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
        </Select>
      </Card>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surfaceAlt">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs text-textMute w-12"></th>
              {grid.cols.map((c) => (
                <th key={c} className="px-2 py-1.5 text-left text-xs text-textMute min-w-[140px]">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((r) => (
              <tr key={r} className="border-t border-border">
                <td className="px-2 py-1.5 text-xs text-textMute">{r}</td>
                {grid.cols.map((c) => {
                  const ref = `${c}${r}`
                  const cell = grid.byRef.get(ref)
                  return (
                    <td key={ref} className="border-l border-border">
                      <input
                        defaultValue={cell?.value ?? ''}
                        onBlur={(e) => setCell(ref, e.target.value)}
                        className="w-full bg-transparent px-2 py-1.5 text-sm focus:outline-none focus:bg-surfaceAlt"
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="text-xs text-textMute mt-2">셀 편집 후 포커스 아웃 시 저장. 다른 브라우저에서 2초 내 반영.</div>
    </div>
  )
}

function buildGrid(cells: Cell[]) {
  const byRef = new Map<string, Cell>()
  const colSet = new Set<string>()
  const rowSet = new Set<number>()
  for (const c of cells) {
    byRef.set(c.cell_ref, c)
    const m = c.cell_ref.match(/^([A-Z]+)(\d+)$/)
    if (m) {
      colSet.add(m[1])
      rowSet.add(parseInt(m[2], 10))
    }
  }
  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].filter((c) => colSet.has(c) || colSet.size < 4)
  const maxRow = Math.max(8, ...Array.from(rowSet))
  const rows = Array.from({ length: maxRow + 1 }, (_, i) => i + 1)
  return { cols, rows, byRef }
}
