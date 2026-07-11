// Lecture LiveOps — entity smoke (P1-1: admin context로 호출)
// 13 entity 각각 read/write/cleanup. neon mode 전용 (호출은 probe route에서 isNeonEnabled() 확인 후).
// admin context 사용 — RLS 정책상 admin은 전체 접근. anon role 기반 isolation 검증은 별도 시나리오 D 강화 케이스.

import {
  companies,
  courses,
  sessions,
  accessKeys,
  qna,
  practice,
  resources,
  opsLogs,
  signals,
  tableStatuses,
  excel,
  exportJobs,
  externalArchives,
  ledger
} from './repo'
import { adminContext } from './neonHelpers'

export type EntitySmokeResult = {
  total: number
  pass: number
  fail: number
  details: Record<string, { status: 'PASS' | 'FAIL'; note: string }>
}

export async function runEntitySmoke(): Promise<EntitySmokeResult> {
  const details: Record<string, { status: 'PASS' | 'FAIL'; note: string }> = {}
  const stamp = Date.now().toString(36)
  const tag = `smoke-${stamp}`

  let companyId = ''
  let courseId = ''
  let sessionId = ''
  let templateId = ''
  const adm = () => adminContext(sessionId || undefined)

  await wrap(details, 'companies', async () => {
    const c = await companies.insert(adm(), {
      name: `Smoke 회사 ${tag} (DEMO)`,
      slug: `smoke-${tag}`,
      visibility: 'private',
      retention_policy: '7d'
    })
    companyId = c.id
    const found = await companies.findById(adm(), c.id)
    if (!found) throw new Error('not found after insert')
    return `insert+read ok (${c.id})`
  })

  await wrap(details, 'courses', async () => {
    if (!companyId) throw new Error('no companyId')
    const c = await courses.insert(adm(), {
      company_id: companyId,
      title: `Smoke 강의 ${tag} (DEMO)`,
      description: '',
      default_venue: '',
      status: 'active'
    })
    courseId = c.id
    const list = await courses.findByCompany(adm(), companyId)
    if (!list.find((x) => x.id === c.id)) throw new Error('not in findByCompany')
    return `insert+read ok (${c.id})`
  })

  await wrap(details, 'sessions', async () => {
    if (!companyId || !courseId) throw new Error('chain broken')
    const s = await sessions.insert(adm(), {
      company_id: companyId,
      course_id: courseId,
      date: new Date().toISOString().slice(0, 10),
      title: `Smoke 세션 ${tag} (DEMO)`,
      venue: '',
      mode: 'prep',
      private_by_default: true,
      metadata: { smoke: true }
    })
    sessionId = s.id
    await sessions.updateMode(adm(), s.id, 'live')
    const fresh = await sessions.findById(adm(), s.id)
    if (fresh?.mode !== 'live') throw new Error('updateMode failed')
    return `insert+updateMode ok (${s.id})`
  })

  await wrap(details, 'access_keys', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const k = await accessKeys.issue(adm(), {
      session_id: sessionId,
      role: 'participant',
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      rawKey: `smoke-raw-${tag}`
    })
    const list = await accessKeys.list(adm(), sessionId)
    if (!list.find((x) => x.id === k.id)) throw new Error('issue+list mismatch')
    await accessKeys.revoke(adm(), k.id)
    await accessKeys.delete(adm(), k.id)
    return `issue+revoke+delete ok`
  })

  await wrap(details, 'qna_items', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const q = await qna.insert(adm(), {
      session_id: sessionId,
      body: `Smoke 질문 ${tag} (DEMO)`,
      answer: null,
      status: 'new',
      priority: 'normal',
      tags: ['smoke'],
      visibility: 'session',
      created_by_role: 'participant'
    })
    await qna.answer(adm(), q.id, 'Smoke 답변 (DEMO)', 'answered')
    const fresh = await qna.findById(adm(), q.id)
    if (fresh?.status !== 'answered') throw new Error('answer failed')
    await qna.delete(adm(), q.id)
    return `insert+answer+delete ok`
  })

  await wrap(details, 'practice_tickets', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const p = await practice.insert(adm(), {
      session_id: sessionId,
      table_label: `t-${tag}`,
      body: `Smoke 실습 (DEMO)`,
      status: 'help_needed',
      severity: 'normal',
      assigned_assistant_id: null
    })
    await practice.update(adm(), p.id, { status: 'solved' })
    const fresh = await practice.findById(adm(), p.id)
    if (fresh?.status !== 'solved') throw new Error('update failed')
    await practice.delete(adm(), p.id)
    return `insert+update+delete ok`
  })

  await wrap(details, 'resources', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const r = await resources.insert(adm(), {
      session_id: sessionId,
      type: 'link',
      title: `Smoke 자료 ${tag} (DEMO)`,
      url_or_storage_path: 'https://example.com/smoke',
      visibility: 'session',
      stage_tags: [],
      audience_tags: []
    })
    await resources.updateVisibility(adm(), r.id, 'public')
    await resources.delete(adm(), r.id)
    return `insert+updateVisibility+delete ok`
  })

  await wrap(details, 'ops_logs', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const o = await opsLogs.insert(adm(), {
      session_id: sessionId,
      type: 'note',
      body: `Smoke 운영 로그 ${tag} (DEMO)`,
      visibility: 'private',
      created_by_role: 'assistant'
    })
    const list = await opsLogs.list(adm(), sessionId)
    if (!list.find((x) => x.id === o.id)) throw new Error('list missing')
    await opsLogs.delete(adm(), o.id)
    return `insert+list+delete ok`
  })

  await wrap(details, 'assistant_signals', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const sg = await signals.insert(adm(), {
      session_id: sessionId,
      signal_type: 'speed_down',
      table_label: '',
      note: `Smoke 신호 ${tag} (DEMO)`,
      acknowledged_at: null
    })
    await signals.acknowledge(adm(), sg.id)
    await signals.delete(adm(), sg.id)
    return `insert+acknowledge+delete ok`
  })

  await wrap(details, 'table_statuses', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const t = await tableStatuses.upsert(adm(), {
      session_id: sessionId,
      table_label: `tab-${tag}`,
      progress: 'following'
    })
    const t2 = await tableStatuses.upsert(adm(), {
      session_id: sessionId,
      table_label: `tab-${tag}`,
      progress: 'blocked',
      blocker: 'Smoke blocker'
    })
    if (t.id !== t2.id) throw new Error('upsert duplicated')
    if (t2.progress !== 'blocked') throw new Error('upsert update failed')
    return `upsert idempotent ok`
  })

  await wrap(details, 'excel_templates_cells', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const tpl = await excel.insertTemplate(adm(), {
      session_id: sessionId,
      title: `Smoke 템플릿 ${tag} (DEMO)`,
      version: 1,
      source_resource_id: null,
      schema_json: {}
    })
    templateId = tpl.id
    const c1 = await excel.upsertCell(adm(), { template_id: tpl.id, sheet_name: 'Sheet1', cell_ref: 'A1', value: 'v1', updated_by: 'smoke' })
    const c2 = await excel.upsertCell(adm(), { template_id: tpl.id, sheet_name: 'Sheet1', cell_ref: 'A1', value: 'v2', updated_by: 'smoke' })
    if (c1.cell_ref !== c2.cell_ref) throw new Error('cell ref mismatch')
    const cells = await excel.listCells(adm(), tpl.id)
    if (cells.length < 1 || cells[0].value !== 'v2') throw new Error('cell list/value mismatch')
    return `template+cell upsert ok (${cells.length} cells)`
  })

  await wrap(details, 'export_jobs', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const j = await exportJobs.insert(adm(), {
      session_id: sessionId,
      profile: 'internal_retro',
      formats: ['md'],
      status: 'queued',
      output_paths: { smoke: true }
    })
    await exportJobs.updateStatus(adm(), j.id, 'completed')
    await exportJobs.delete(adm(), j.id)
    return `insert+updateStatus+delete ok`
  })

  await wrap(details, 'external_archives', async () => {
    if (!sessionId) throw new Error('no sessionId')
    const o = await externalArchives.insert(adm(), {
      session_id: sessionId,
      target_path: `/tmp/smoke-${tag}-DEMO`,
      status: 'dry_run',
      frontmatter: { smoke: true }
    })
    await externalArchives.delete(adm(), o.id)
    return `insert+delete ok`
  })

  await wrap(details, 'action_ledger', async () => {
    const l = await ledger.insert(adm(), {
      session_id: sessionId || null,
      actor_type: 'system',
      actor_role: 'admin',
      tool: 'web-ui',
      action_name: 'smoke.test',
      input_hash: `hash-${tag}`,
      input_redacted_summary: '[smoke]',
      output_summary: 'ok',
      status: 'ok'
    })
    await ledger.delete(adm(), l.id)
    return `insert+delete ok`
  })

  // cleanup chain (owner-level queryOwner 사용 — anon에는 cascade 권한 보장만)
  const { queryOwner } = await import('./neonHelpers')
  if (templateId) try { await queryOwner(`delete from excel_templates where id = $1`, [templateId]) } catch {}
  if (sessionId) try { await queryOwner(`delete from sessions where id = $1`, [sessionId]) } catch {}
  if (courseId) try { await queryOwner(`delete from courses where id = $1`, [courseId]) } catch {}
  if (companyId) try { await queryOwner(`delete from companies where id = $1`, [companyId]) } catch {}

  const pass = Object.values(details).filter((d) => d.status === 'PASS').length
  const fail = Object.values(details).filter((d) => d.status === 'FAIL').length
  return { total: Object.keys(details).length, pass, fail, details }
}

async function wrap(
  bag: Record<string, { status: 'PASS' | 'FAIL'; note: string }>,
  name: string,
  fn: () => Promise<string>
): Promise<void> {
  try {
    const note = await fn()
    bag[name] = { status: 'PASS', note }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error'
    bag[name] = { status: 'FAIL', note: msg.slice(0, 200) }
  }
}
