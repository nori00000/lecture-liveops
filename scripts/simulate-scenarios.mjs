#!/usr/bin/env node
// Lecture LiveOps — 04-VALIDATION 시나리오 B~J 자동 검증
// fixture/neon 양쪽에서 동작. 권한, 누수, RLS 우회, external archive 보호, access key 만료/철회 등.
// 사용: LIVEOPS_BASE_URL=http://localhost:3010 node scripts/simulate-scenarios.mjs

import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'
const RUN_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '-sim-scenarios'
const OUT_DIR = path.join(ROOT, '_workspace', 'simulation', RUN_ID)
mkdirSync(OUT_DIR, { recursive: true })

const results = []
function record(id, name, status, detail) {
  results.push({ id, name, status, detail, ts: new Date().toISOString() })
  console.log(`[${status}] ${id} ${name} — ${detail}`)
}

async function call(action, role, input, opts = {}) {
  const env = {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope: opts.scope ?? (input?.sessionId ? { sessionId: input.sessionId } : {}),
    idempotencyKey: opts.idempotencyKey ?? `scen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    redactionPolicy: opts.redactionPolicy ?? 'summary',
    dryRun: opts.dryRun ?? false,
    input
  }
  const r = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(env)
  })
  return { status: r.status, body: await r.json().catch(() => null) }
}

async function get(url) {
  const r = await fetch(BASE + url, { cache: 'no-store' })
  return { status: r.status, body: await r.json().catch(() => null) }
}

;(async () => {
  console.log(`run_id: ${RUN_ID}`)
  console.log(`base  : ${BASE}\n`)

  const sessionData = (await get('/api/data/session')).body
  const sessionId = sessionData?.session?.id ?? 'se-001-DEMO'

  const salt = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  // === Scenario B: LLM action abuse ===
  const denyQ = await call('liveops.answer_qna', 'participant', { qnaId: 'qn-001-DEMO', answer: 'denied-' + salt, status: 'answered' }, { scope: { sessionId } })
  record('B', 'LLM action abuse (participant answer_qna)',
    denyQ.status === 403 && denyQ.body?.status === 'denied' ? 'PASS' : 'FAIL',
    `status=${denyQ.status}`)

  // === Scenario C: Public leak grep ===
  // 실제 시크릿 값/실제 회사명 노출 검사. env var name은 leak이 아님 (값이 코드에 박혀 있어야 leak).
  const BAN = ['sk_live_', 'sk-ant-', 'eyJhbGciOi', 'postgres://neondb_owner', 'postgresql://neondb_owner']
  // 실제 회사명은 -DEMO 접미사 없이 단독 등장 시 leak. ban list에 별도 처리.
  const REAL_COMPANY = ['실제 기관명', 'Actual Organization', 'Private Client']
  function walk(dir, acc = []) {
    for (const f of readdirSync(dir)) {
      if (f === 'node_modules' || f === '.next' || f === '_workspace' || f === '.git') continue
      const p = path.join(dir, f)
      try {
        const s = statSync(p)
        if (s.isDirectory()) walk(p, acc)
        else acc.push(p)
      } catch {}
    }
    return acc
  }
  // public-facing 영역: app/, public/, README 등. DEMO 접미사가 항상 붙은 데이터만 통과해야 함.
  // 단, 본 시나리오 스크립트 자체와 fixture seed의 회사명 "샘플 기관 A"는 DEMO 접미사라 banned tokens에 포함되지 않음
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'lib')))
  let leakHits = 0
  for (const f of files) {
    if (!/\.(ts|tsx|json|md)$/.test(f)) continue
    const txt = readFileSync(f, 'utf8')
    // secrets
    for (const t of BAN) {
      if (txt.includes(t)) {
        leakHits++
        console.log('  leak[secret] in', f, '→', t)
      }
    }
    // real company names (단독, -DEMO 없이)
    for (const c of REAL_COMPANY) {
      const re = new RegExp(c + '(?!-DEMO)', 'g')
      const m = txt.match(re)
      if (m) {
        leakHits++
        console.log('  leak[company] in', f, '→', c)
      }
    }
  }
  record('C', 'Public route leak grep',
    leakHits === 0 ? 'PASS' : 'FAIL',
    `${leakHits}건 leak`)

  // === Scenario D: RLS 실제 작동 검증 (anon role + JWT claim) ===
  // P1-1 강화: 코드 레벨 필터 제거하고 anon role + ctx 주입으로 raw SELECT 검증.
  // 1) HTTP API 레벨 — admin context이지만 session_id 필터 동작
  const otherSession = 'se-003-DEMO'
  const dataD = (await get('/api/data/session?sessionId=' + otherSession)).body
  const dRows = dataD?.qna ?? []
  const dWrongSession = dRows.filter((q) => q.session_id !== otherSession).length

  // 2) 직접 anon SQL — participant context + 다른 session_id 시도 → 0 row (RLS 차단)
  let rlsDirect = { read_other: -1, insert_other: 'unknown' }
  try {
    const { neon } = await import('@neondatabase/serverless')
    const anonUrl = process.env.DATABASE_URL_ANON
    if (anonUrl) {
      const sql = neon(anonUrl)
      // participant on se-001 attempting to read se-003
      const r1 = await sql.transaction([
        sql`select set_config('request.jwt.claims', '{"role":"participant"}', true)`,
        sql`select set_config('request.headers', '{"x-session-id":"se-001-DEMO"}', true)`,
        sql`select count(*)::int as c from qna_items where session_id = 'se-003-DEMO'`
      ])
      rlsDirect.read_other = r1[2][0].c

      // participant on se-001 attempting INSERT into se-003
      try {
        await sql.transaction([
          sql`select set_config('request.jwt.claims', '{"role":"participant"}', true)`,
          sql`select set_config('request.headers', '{"x-session-id":"se-001-DEMO"}', true)`,
          sql.query(`insert into qna_items (id, session_id, body, body_redacted, status, priority, tags, visibility, created_by_role, created_at, updated_at) values ($1, 'se-003-DEMO', 'rls-bypass-attempt', 'rls-bypass', 'new', 'low', '{}', 'session', 'participant', now(), now())`, ['qn-rls-test-' + Date.now()])
        ])
        rlsDirect.insert_other = 'ALLOWED-BAD'
      } catch (e) {
        // 정책에 의해 RLS 차단
        rlsDirect.insert_other = /row-level security|42501|new row violates/i.test(e.message) ? 'BLOCKED-OK' : 'ERROR'
      }
    } else {
      rlsDirect.insert_other = 'no-anon-url'
    }
  } catch (e) {
    rlsDirect.insert_other = 'anon-init-fail: ' + e.message.slice(0, 50)
  }

  const dPass = dWrongSession === 0 && rlsDirect.read_other === 0 && rlsDirect.insert_other === 'BLOCKED-OK'
  record('D', 'RLS 실제 작동 (anon + JWT)',
    dPass ? 'PASS' : 'FAIL',
    `api-filter=${dWrongSession === 0 ? 'ok' : 'fail'}, raw-read-other-session=${rlsDirect.read_other}, raw-insert-other=${rlsDirect.insert_other}`)

  // === Scenario E: external archive 보호 경로 침범 ===
  const blocked = await call('liveops.preview_archive_target', 'instructor', { sessionId, targetPath: '/tmp/lecture-liveops/.git/blocked-' + salt }, { scope: { sessionId } })
  record('E', 'external archive 보호 경로 차단',
    blocked.body?.data?.status === 'blocked' ? 'PASS' : 'FAIL',
    `status=${blocked.body?.data?.status}`)

  // === Scenario F: Access key 만료/철회 ===
  // 만료된 임의 키 시도
  const expiredCheck = await get('/api/data/participant/' + encodeURIComponent('expired-key-DEMO'))
  // 정상 키 시도
  const validCheck = await get('/api/data/participant/' + encodeURIComponent('se-001-DEMO-part-1'))
  record('F', 'Access key 만료/잘못된 키',
    expiredCheck.status === 403 && validCheck.status === 200 ? 'PASS' : 'FAIL',
    `invalid=${expiredCheck.status}, valid=${validCheck.status}`)

  // === Scenario G: Supabase env 부재 → fixture (현 환경은 neon이므로 다른 검증) ===
  const health = (await get('/api/health')).body
  record('G', 'getMode() 분기 동작',
    ['fixture', 'neon', 'supabase'].includes(health?.mode) ? 'PASS' : 'FAIL',
    `mode=${health?.mode}`)

  // === Scenario H: Offline queue (코드 존재 검증) ===
  // server-side idempotency Map은 lib/action/idempotency.ts, client-side queue는 lib/offline/queue.ts(idb)
  const offlineSrc = readFileSync(path.join(ROOT, 'lib', 'offline', 'queue.ts'), 'utf8')
  const idemSrc = readFileSync(path.join(ROOT, 'lib', 'action', 'idempotency.ts'), 'utf8')
  const idb = /from 'idb'/.test(offlineSrc) && /openDB/.test(offlineSrc) && /enqueue|flush/.test(offlineSrc)
  const dedupe = /idempotencyKey/.test(idemSrc) || /cached/.test(idemSrc)
  record('H', 'Offline queue + IndexedDB + server idempotency',
    idb && dedupe ? 'PASS' : 'FAIL',
    `idb=${idb} server-dedupe=${dedupe}`)

  // === Scenario I: Excel cell 동시 편집 last-write-wins ===
  const tplData = (await get('/api/data/session?sessionId=' + sessionId)).body
  const tplId = tplData?.excel_templates?.[0]?.id
  let iPass = false
  if (tplId) {
    const cellRef = 'Z' + (Math.floor(Math.random() * 100) + 1)
    await call('liveops.update_excel_cell', 'participant', { sessionId, templateId: tplId, sheetName: 'Sheet1', cellRef, value: 'v1' }, { scope: { sessionId } })
    await call('liveops.update_excel_cell', 'participant', { sessionId, templateId: tplId, sheetName: 'Sheet1', cellRef, value: 'v2' }, { scope: { sessionId } })
    const cells = (await get('/api/data/excel?templateId=' + tplId)).body?.cells ?? []
    const cell = cells.find((c) => c.cell_ref === cellRef)
    iPass = cell?.value === 'v2'
  }
  record('I', 'Excel cell last-write-wins',
    iPass ? 'PASS' : 'FAIL',
    `final=v2 ${iPass}`)

  // === Scenario J: LLM envelope 위반 → 400 ===
  const r = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: { type: 'llm', role: 'admin' }, input: {} }) // action 누락
  })
  const jBody = await r.json().catch(() => null)
  record('J', 'LLM envelope 위반 → 400',
    r.status === 400 && jBody?.status === 'invalid' ? 'PASS' : 'FAIL',
    `status=${r.status}`)

  // === Scenario K: CSRF 우회 시도 (P1-3) ===
  // origin 헤더 있으면서 CSRF 토큰 없으면 → 403
  const noToken = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': BASE },
    body: JSON.stringify({})
  })
  const noTokenBody = await noToken.json().catch(() => null)
  // origin 헤더 있으면서 토큰 mismatch → 403
  const mismatch = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'origin': BASE, 'x-csrf-token': 'WRONG', 'cookie': 'liveops_csrf=DIFFERENT' },
    body: JSON.stringify({})
  })
  const mismatchBody = await mismatch.json().catch(() => null)
  // 정상 토큰 흐름 — /api/csrf 발급 후 동일 토큰을 cookie+header
  const tokRes = await fetch(BASE + '/api/csrf')
  const setCookie = tokRes.headers.get('set-cookie') ?? ''
  const tok = (await tokRes.json()).token
  const okRes = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': BASE,
      'x-csrf-token': tok,
      'cookie': `liveops_csrf=${tok}`
    },
    body: JSON.stringify({
      action: 'liveops.get_today_session',
      actor: { type: 'human', role: 'admin', tool: 'web-ui' },
      scope: {},
      idempotencyKey: 'csrf-scen-' + Date.now(),
      redactionPolicy: 'summary',
      input: {}
    })
  })
  const okBody = await okRes.json().catch(() => null)
  const kPass = noToken.status === 403 && noTokenBody?.error === 'csrf_invalid'
    && mismatch.status === 403 && mismatchBody?.error === 'csrf_invalid'
    && okRes.status === 200 && okBody?.ok === true
  record('K', 'CSRF token gate (double-submit cookie)',
    kPass ? 'PASS' : 'FAIL',
    `no-token=${noToken.status} mismatch=${mismatch.status} valid=${okRes.status}`)

  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  const summary = {
    run_id: RUN_ID,
    base: BASE,
    session_id: sessionId,
    total: results.length,
    pass,
    fail,
    scenarios: results,
    completed_at: new Date().toISOString()
  }
  writeFileSync(path.join(OUT_DIR, 'scenarios.json'), JSON.stringify(summary, null, 2))
  console.log(`\n=== SCENARIOS SUMMARY ===\nPASS ${pass} / FAIL ${fail} / TOTAL ${results.length}`)
  console.log('saved:', path.join(OUT_DIR, 'scenarios.json'))
  process.exit(fail > 0 ? 1 : 0)
})()
