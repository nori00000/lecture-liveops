#!/usr/bin/env node
// Lecture LiveOps — 숙의 워크숍 시뮬레이션 (PRODUCT-PLAN-v2 §3 3단계 리허설)
// 30명·80명 시나리오: 가짜 참가자·그룹 배정·라운드·의견 20개·투표 ~1000개를 seed 하고 리포트 생성까지 스모크.
//
// 전제: dev/prod server 가 http://localhost:3010 에서 동작 중이어야 함 (simulate-day.mjs 와 동일 패턴).
// 사용:  npm run dev &  ;  node scripts/simulate-workshop.mjs
// 모드:  server 가 fixture 면 fixture store 에, DATABASE_URL 이 설정된 neon 이면 Neon 에 seed 된다(서버가 결정).
// 안전:  operator key 미설정 dev 에서만 리포트 다운로드가 열린다. 외부 endpoint 호출 0.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const RUN_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '-sim-workshop'
const OUT_DIR = path.join(ROOT, '_workspace', 'simulation', RUN_ID)
mkdirSync(OUT_DIR, { recursive: true })

const VOTES = ['agree', 'disagree', 'pass']

// CSRF double-submit 토큰 — /api/csrf 에서 1회 발급받아 cookie+header 로 재사용.
let CSRF_TOKEN = ''

function log(status, step, detail) {
  const tag = status === 'PASS' ? 'PASS' : status === 'INFO' ? 'INFO' : 'FAIL'
  console.log(`[${tag}] ${step} — ${detail}`)
}

async function fetchCsrf() {
  const res = await fetch(BASE + '/api/csrf')
  const body = await res.json().catch(() => null)
  if (!body?.token) throw new Error('CSRF 토큰 발급 실패')
  CSRF_TOKEN = body.token
}

async function call(action, role, input, scope = {}) {
  const envelope = {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope,
    idempotencyKey: `${RUN_ID}-${action}-${Math.random().toString(36).slice(2, 8)}`,
    redactionPolicy: 'summary',
    dryRun: false,
    input
  }
  // Origin 헤더(origin 검사) + CSRF double-submit(cookie==header) 통과에 필요.
  const res = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      cookie: `liveops_csrf=${CSRF_TOKEN}`,
      'x-csrf-token': CSRF_TOKEN
    },
    body: JSON.stringify(envelope)
  })
  const body = await res.json().catch(() => null)
  if (res.status !== 200 || body?.ok === false) {
    throw new Error(`${action} 실패 (status ${res.status}): ${body?.error ?? 'unknown'}`)
  }
  return body
}

// 동시성 풀 — 대량 투표 요청을 chunk 로 나눠 병렬 실행.
async function pool(items, size, worker) {
  let done = 0
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size)
    await Promise.all(chunk.map(worker))
    done += chunk.length
  }
  return done
}

async function runScenario(scn) {
  const scope = {}
  log('INFO', scn.name, `참가자 ${scn.participants}명 · 그룹 ${scn.groups}개 · 의견 ${scn.statements}개 시작`)

  // 1. 세션 생성 (fresh — 재실행 시 round_index 충돌 회피)
  const created = await call('liveops.create_lecture_session', 'instructor', {
    companyName: `시뮬주최-${scn.name}-${RUN_ID}`,
    title: `숙의 시뮬 ${scn.name}`,
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
    venue: '시뮬 강의장',
    category: '숙의 워크숍'
  })
  const sessionId = created.data?.id
  if (!sessionId) throw new Error('세션 ID 누락')
  scope.sessionId = sessionId

  // 2. 프라이버시 사전 합의 + 워크숍 부트스트랩
  await call('delib.update_workshop_settings', 'instructor', {
    sessionId, anonymousMode: scn.anonymous, disclosure: 'operators_only', retentionDays: 30,
    minorSession: false, consentConfirmed: true
  }, scope)
  await call('delib.create_workshop', 'instructor', { sessionId, title: '오프닝' }, scope)
  const roundRes = await call('delib.start_round', 'instructor', { sessionId, roundIndex: 1, title: '핵심 쟁점', mode: 'breakout' }, scope)
  const roundId = roundRes.data.roundId

  // 3. 그룹 생성
  const groupIds = []
  for (let g = 0; g < scn.groups; g++) {
    const r = await call('delib.upsert_group', 'instructor', { sessionId, label: `${g + 1}조`, topic: `분임 ${g + 1}` }, scope)
    groupIds.push(r.data.groupId)
  }

  // 4. 참가자 등록 + 그룹 배정
  const pids = []
  await pool([...Array(scn.participants).keys()], 20, async (i) => {
    const r = await call('delib.register_participant', 'instructor', { sessionId, displayAlias: `참가자${i + 1}`, anonHandle: `anon-${i + 1}` }, scope)
    const pid = r.data.participantId
    pids.push(pid)
    await call('delib.assign_participant', 'instructor', { participantId: pid, groupId: groupIds[i % scn.groups] }, scope)
  })

  // 5. 의견 20개 (operator 대리 제출, 라운드/그룹 연결)
  const stIds = []
  for (let s = 0; s < scn.statements; s++) {
    const r = await call('delib.submit_statement', 'instructor', {
      sessionId, roundId, groupId: groupIds[s % scn.groups],
      authorParticipantId: pids[s % pids.length], body: `쟁점 의견 ${s + 1}: 시뮬 발언 본문`
    }, scope)
    stIds.push(r.data.statementId)
  }

  // 6. 투표 — 참가자 × 발언, density 확률로. 발언마다 성향을 달리해 합의/쟁점을 만든다.
  const voteTasks = []
  for (let s = 0; s < stIds.length; s++) {
    const bias = s % 3 // 0=합의(찬성 쏠림), 1=쟁점(팽팽), 2=반대 우세
    for (let v = 0; v < pids.length; v++) {
      if (Math.random() > scn.density) continue
      let vote
      if (bias === 0) vote = Math.random() < 0.85 ? 'agree' : VOTES[Math.floor(Math.random() * 3)]
      else if (bias === 1) vote = Math.random() < 0.5 ? 'agree' : 'disagree'
      else vote = Math.random() < 0.75 ? 'disagree' : 'agree'
      voteTasks.push({ statementId: stIds[s], participantId: pids[v], vote })
    }
  }
  await pool(voteTasks, 40, async (t) => {
    await call('delib.vote_statement', 'instructor', { statementId: t.statementId, participantId: t.participantId, vote: t.vote }, scope)
  })

  // 7. 스냅샷 계산 + 발행
  const snap = await call('delib.compute_snapshot', 'instructor', { sessionId, roundId }, scope)
  await call('delib.publish_snapshot', 'instructor', { snapshotId: snap.data.snapshotId }, scope)

  // 8. 리포트 생성 스모크 (md/html/xlsx)
  const formats = {}
  for (const fmt of ['md', 'html', 'xlsx']) {
    const res = await fetch(`${BASE}/api/export/delib?sessionId=${encodeURIComponent(sessionId)}&format=${fmt}`)
    if (res.status !== 200) throw new Error(`리포트(${fmt}) 다운로드 실패: status ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (fmt === 'md') {
      const text = buf.toString('utf-8')
      if (!text.includes('숙의 워크숍 결과 리포트') || !text.includes('원자료')) throw new Error('md 리포트 내용 이상')
    } else if (fmt === 'html') {
      if (!buf.toString('utf-8').startsWith('<!doctype html>')) throw new Error('html 리포트 내용 이상')
    } else if (fmt === 'xlsx') {
      if (!(buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error('xlsx 리포트 시그니처 이상') // PK
    }
    formats[fmt] = buf.length
  }

  log('PASS', scn.name, `votes=${voteTasks.length} · report md=${formats.md}B html=${formats.html}B xlsx=${formats.xlsx}B`)
  return { name: scn.name, sessionId, participants: pids.length, statements: stIds.length, votes: voteTasks.length, report_bytes: formats }
}

;(async () => {
  console.log(`run_id: ${RUN_ID}`)
  console.log(`base  : ${BASE}`)
  console.log(`out   : ${OUT_DIR}\n`)

  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null)
  if (!health?.ok) {
    log('FAIL', 'PRE', `서버 헬스체크 실패 — dev server 가 ${BASE} 에서 동작 중인지 확인`)
    process.exit(2)
  }
  log('INFO', 'PRE', `mode=${health.mode} service=${health.service}`)
  await fetchCsrf()
  log('INFO', 'PRE', 'CSRF 토큰 발급 완료')

  const scenarios = [
    { name: '30인', participants: 30, groups: 4, statements: 20, density: 1.0, anonymous: false },
    { name: '80인', participants: 80, groups: 6, statements: 20, density: 0.65, anonymous: true }
  ]

  const results = []
  try {
    for (const scn of scenarios) {
      results.push(await runScenario(scn))
    }
  } catch (e) {
    log('FAIL', 'RUN', e instanceof Error ? e.message : String(e))
    writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify({ run_id: RUN_ID, mode: health.mode, results, error: String(e) }, null, 2))
    process.exit(1)
  }

  const summary = { run_id: RUN_ID, base: BASE, mode: health.mode, results, completed_at: new Date().toISOString() }
  writeFileSync(path.join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2))

  console.log(`\n=== WORKSHOP SIMULATION SUMMARY ===`)
  for (const r of results) {
    console.log(`${r.name}: 참가자 ${r.participants} · 의견 ${r.statements} · 투표 ${r.votes} · 리포트 md/html/xlsx ${r.report_bytes.md}/${r.report_bytes.html}/${r.report_bytes.xlsx}B`)
  }
  console.log(`output: ${OUT_DIR}`)
  process.exit(0)
})()
