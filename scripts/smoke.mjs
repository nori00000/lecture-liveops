#!/usr/bin/env node
// Lecture LiveOps — API smoke
// Usage: LIVEOPS_BASE_URL=http://localhost:3010 node scripts/smoke.mjs
import process from 'node:process'

const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'

async function call(path, init) {
  const res = await fetch(BASE + path, init)
  let json
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json }
}

function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) process.exitCode = 1
}

;(async () => {
  // 1) health
  const h = await call('/api/health')
  check('1. /api/health', h.status === 200 && h.body?.ok === true, `mode=${h.body?.mode}`)

  // 2) get_today_session
  const env = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const idk1 = 'smoke-' + Date.now()
  const r2 = await call('/api/action', env({
    action: 'liveops.get_today_session',
    actor: { type: 'human', role: 'admin', tool: 'web-ui' },
    scope: {},
    idempotencyKey: idk1,
    redactionPolicy: 'summary',
    input: {}
  }))
  const sessionId = r2.body?.data?.id
  check('2. liveops.get_today_session', r2.status === 200 && !!sessionId, sessionId)

  // 3) add_qna
  const idk2 = 'smoke-add-' + Date.now()
  const r3 = await call('/api/action', env({
    action: 'liveops.add_qna',
    actor: { type: 'human', role: 'assistant', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: idk2,
    redactionPolicy: 'summary',
    input: { sessionId, body: '스모크 테스트 질문 (DEMO)' }
  }))
  check('3. liveops.add_qna', r3.status === 200 && r3.body?.ok === true, r3.body?.data?.id)

  // 4) idempotent repeat
  const r4 = await call('/api/action', env({
    action: 'liveops.add_qna',
    actor: { type: 'human', role: 'assistant', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: idk2,
    redactionPolicy: 'summary',
    input: { sessionId, body: '스모크 테스트 질문 (DEMO)' }
  }))
  check('4. idempotent repeat', r4.status === 200 && r4.body?.cached === true, `cached=${r4.body?.cached}`)

  // 5) deny: participant tries answer_qna
  const r5 = await call('/api/action', env({
    action: 'liveops.answer_qna',
    actor: { type: 'human', role: 'participant', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'smoke-deny-' + Date.now(),
    redactionPolicy: 'summary',
    input: { qnaId: 'qn-001', answer: 'should be denied', status: 'answered' }
  }))
  check('5. participant denied answer_qna', r5.status === 403 && r5.body?.status === 'denied')

  // 6) export dry plan
  const r6 = await call('/api/action', env({
    action: 'liveops.export_session_archive',
    actor: { type: 'human', role: 'instructor', tool: 'web-ui' },
    scope: { sessionId },
    idempotencyKey: 'smoke-export-' + Date.now(),
    redactionPolicy: 'summary',
    dryRun: false,
    input: { sessionId, profile: 'markdown_archive', formats: ['md'] }
  }))
  check('6. liveops.export_session_archive', r6.status === 200 && Array.isArray(r6.body?.data?.files), `files=${r6.body?.data?.files?.length}`)

  // 7) PDF binary
  const r7 = await fetch(BASE + '/api/export/pdf?sessionId=' + encodeURIComponent(sessionId))
  const r7buf = Buffer.from(await r7.arrayBuffer())
  check('7. /api/export/pdf', r7.status === 200 && r7buf.length > 1000 && r7buf.subarray(0, 4).toString() === '%PDF', `pdf size=${r7buf.length}B`)

  // 8) XLSX binary
  const r8 = await fetch(BASE + '/api/export/xlsx?sessionId=' + encodeURIComponent(sessionId))
  const r8buf = Buffer.from(await r8.arrayBuffer())
  check('8. /api/export/xlsx', r8.status === 200 && r8buf.length > 500 && r8buf[0] === 0x50 && r8buf[1] === 0x4b, `xlsx size=${r8buf.length}B`)

  console.log('\nsmoke done')
})()
