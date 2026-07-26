#!/usr/bin/env node
// Lecture LiveOps — 숙의 워크숍 "시연용 고정 데모" 시드 (PRODUCT-PLAN-v2 §3 4단계)
//
// 목적: 실사용 시연·첫 파일럿용 결정론적 데모 워크숍 1개를 seed 한다.
//   시나리오: "우리 동네 도서관 운영 시간, 어떻게 정할까" — 시민 포럼.
//   참가자 24명 · 그룹(분임) 4개 · plenary+breakout 3라운드 · 의견 15개 · 투표 다수.
//   투표 분포는 코드에 고정되어 있어 실행할 때마다 consensus/divisive/minority 결과판과
//   k-익명 억제(소표본)가 동일하게 재현된다. Math.random 미사용 = 결정론.
//
// 전제: dev/prod server 가 http://localhost:3010 에서 동작 중이어야 한다 (simulate-workshop.mjs 동일 패턴).
//   사용:  LIVEOPS_RATE_LIMIT_DISABLE=1 npm run dev &  ;  node scripts/seed-delib-demo.mjs
//   rate limit: 시드는 짧은 시간에 300+ 운영자 호출을 한다. 이 호출들은 /api/action 을 공유해
//     anon 버킷(30/분)에 걸리므로, 시딩용 dev 서버는 LIVEOPS_RATE_LIMIT_DISABLE=1 로 띄우길 권장한다.
//     (미설정이어도 429 를 지수 백오프로 재시도하지만 매우 느리다.)
//   모드:  server 가 fixture 면 fixture store 에, DATABASE_URL 이 설정된 Neon 이면 Neon 에 seed 된다(서버가 결정).
//   안전:  delib.* / liveops.* 액션만 호출한다. 외부 endpoint 호출 0.
//
// 실행 후: 운영자가 콘솔·프로젝터·리포트를 바로 볼 수 있는 접속 정보를 출력한다.

import process from 'node:process'

const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'
const RUN_ID = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '-demo'
const CONCURRENCY = 4
const MAX_RETRIES = 6

let CSRF_TOKEN = ''

function log(status, step, detail) {
  const tag = status === 'PASS' ? 'PASS' : status === 'INFO' ? 'INFO' : 'FAIL'
  console.log(`[${tag}] ${step} — ${detail}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryDelayMs(res, attempt) {
  const retryAfter = Number.parseFloat(res.headers.get('retry-after') ?? '')
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1000)
  return Math.min(30_000, 500 * (2 ** attempt)) + 100
}

async function fetchCsrf() {
  const res = await fetch(BASE + '/api/csrf')
  const body = await res.json().catch(() => null)
  if (!body?.token) throw new Error('CSRF 토큰 발급 실패')
  CSRF_TOKEN = body.token
}

// 결정론적 idempotency 카운터 — Math.random 대신 단조 증가 시퀀스로 키를 만든다.
let SEQ = 0

async function call(action, role, input, scope = {}) {
  const envelope = {
    action,
    actor: { type: 'human', role, tool: 'web-ui' },
    scope,
    idempotencyKey: `${RUN_ID}-${action}-${String(SEQ++).padStart(5, '0')}`,
    redactionPolicy: 'summary',
    dryRun: false,
    input
  }
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
    if (res.status === 200 && body?.ok !== false) return body
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delay = retryDelayMs(res, attempt)
      log('INFO', action, `rate limited; retry ${attempt + 1}/${MAX_RETRIES} after ${Math.ceil(delay / 1000)}s`)
      await sleep(delay)
      continue
    }
    throw new Error(`${action} 실패 (status ${res.status}): ${body?.error ?? 'unknown'}`)
  }
  throw new Error(`${action} 실패: retry exhausted`)
}

async function pool(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker))
  }
}

// ============================================================
// 결정론적 시나리오 정의 — "우리 동네 도서관 운영 시간, 어떻게 정할까"
// ============================================================
const PARTICIPANTS = 24
const GROUPS = [
  { label: '1조', topic: '평일 야간 연장' },
  { label: '2조', topic: '주말·공휴일 운영' },
  { label: '3조', topic: '청소년·학습 공간' },
  { label: '4조', topic: '예산·인력·자원봉사' }
]

// 라운드: 0=오프닝 plenary(create_workshop 이 생성), 1=분임 breakout, 2=전체 종합 plenary
// 필드명은 delib.start_round 입력 스키마(roundIndex)에 맞춘다.
const ROUNDS = {
  r1: { roundIndex: 1, title: '분임 토론 — 운영 시간 대안', mode: 'breakout' },
  r2: { roundIndex: 2, title: '전체 종합 — 우선순위 투표', mode: 'plenary' }
}

// 의견 15개. r=라운드 키(r0=오프닝), g=그룹 index(0~3), a/d/p=찬성/반대/유보 표수(고정).
// moderate: 'flag' 이면 제출 후 신고 처리 → 모더레이션 큐에 노출되고 집계에서 제외.
// 설계 의도:
//   consensus(합의): S1·S5·S10·S13·S14 (한쪽 강한 쏠림)
//   divisive(쟁점):  S2·S6 (찬반 팽팽)
//   minority(소수):  S3·S7·S8 (전체 다수=찬성인데 반대 우세 → 소수의견 카드)
//   k-익명 억제:     S11·S15 (총 2표 → 개인 표 역추론 위험, 수치 마스킹)
//   moderation:      S12 (신고 → 큐 노출·집계 제외)
const STATEMENTS = [
  { key: 'S1', r: 'r0', g: 0, a: 18, d: 3, p: 1, body: '평일 저녁 9시까지 개관 시간을 연장하는 것이 가장 시급하다.' },
  { key: 'S2', r: 'r0', g: 1, a: 11, d: 10, p: 2, body: '주말 개관을 오전 9시로 앞당기자.' },
  { key: 'S3', r: 'r0', g: 3, a: 5, d: 14, p: 2, body: '예산 한계상 야간 연장은 비현실적이므로 반대한다.' },
  { key: 'S4', r: 'r1', g: 0, a: 15, d: 4, p: 1, body: '열람실만 야간에 연장 개방하고 나머지 층은 정시 마감하자.' },
  { key: 'S5', r: 'r1', g: 3, a: 17, d: 2, p: 2, body: '무인 반납·대출기를 도입해 인건비를 줄이면 연장 여력이 생긴다.' },
  { key: 'S6', r: 'r1', g: 2, a: 9, d: 9, p: 3, body: '청소년 전용 이용 시간대를 신설하자.' },
  { key: 'S7', r: 'r1', g: 1, a: 6, d: 13, p: 2, body: '일요일 휴관을 폐지하고 연중무휴로 운영하자.' },
  { key: 'S8', r: 'r1', g: 0, a: 4, d: 16, p: 1, body: '라운지를 24시간 개방해 심야 자율 학습 공간으로 쓰자.' },
  { key: 'S9', r: 'r1', g: 3, a: 12, d: 7, p: 2, body: '지역 자원봉사자를 활용해 저녁 시간대를 운영하자.' },
  { key: 'S10', r: 'r1', g: 2, a: 14, d: 3, p: 1, body: '조용한 열람실을 확대해 달라는 요구가 많다.' },
  { key: 'S11', r: 'r1', g: 2, a: 1, d: 1, p: 0, body: '특정 소모임만을 위한 심야 개방을 요청한다.' }, // 총 2표 → 억제
  { key: 'S12', r: 'r1', g: 1, a: 0, d: 0, p: 0, moderate: 'flag', body: '[신고 예시] 특정 이용자를 비난하는 부적절 발언 — 모더레이션 시연용.' },
  { key: 'S13', r: 'r2', g: 0, a: 20, d: 2, p: 1, body: '최우선 과제로 평일 야간 연장을 채택하자.' },
  { key: 'S14', r: 'r2', g: 3, a: 16, d: 3, p: 2, body: '시 예산 확보를 위한 주민 청원을 진행하자.' },
  { key: 'S15', r: 'r2', g: 2, a: 2, d: 0, p: 0, body: '야간 연장에 반대하는 소수 입장도 회의록에 남기자.' } // 총 2표 → 억제
]

// 결정론적 투표 배정 — 발언 index 마다 offset 을 달리해 24명 중 (a+d+p)명이 서로 다른 표를 던진다.
function votePlan(stmtIndex, pids, counts) {
  const offset = (stmtIndex * 7) % PARTICIPANTS
  const total = counts.a + counts.d + counts.p
  const votes = []
  for (let k = 0; k < total; k++) {
    const pid = pids[(offset + k) % PARTICIPANTS]
    const vote = k < counts.a ? 'agree' : k < counts.a + counts.d ? 'disagree' : 'pass'
    votes.push({ pid, vote })
  }
  return votes
}

async function seedDemo() {
  const scope = {}

  // 1. 세션 생성 (오늘 날짜, 시연용 주최명)
  const created = await call('liveops.create_lecture_session', 'instructor', {
    companyName: '동네도서관 시민포럼(데모)',
    title: '우리 동네 도서관 운영 시간, 어떻게 정할까',
    date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()),
    venue: '중앙도서관 다목적실',
    category: '숙의 워크숍'
  })
  const sessionId = created.data?.id
  if (!sessionId) throw new Error('세션 ID 누락')
  scope.sessionId = sessionId
  log('INFO', 'session', sessionId)

  // 2. 프라이버시 사전 합의 게이트 + 오프닝 라운드(round 0 plenary) 부트스트랩
  await call('delib.update_workshop_settings', 'instructor', {
    sessionId, anonymousMode: true, disclosure: 'operators_only', retentionDays: 30,
    minorSession: false, consentConfirmed: true
  }, scope)
  const opening = await call('delib.create_workshop', 'instructor', { sessionId, title: '오프닝 — 우리 동네 도서관, 무엇이 문제인가' }, scope)
  const openingRoundId = opening.data.roundId
  log('INFO', 'privacy', '사전 합의 확정 · 익명 모드 · operators_only · 30일 보관')

  // 3. 그룹(분임) 4개 생성
  const groupIds = []
  for (const g of GROUPS) {
    const r = await call('delib.upsert_group', 'instructor', { sessionId, label: g.label, topic: g.topic }, scope)
    groupIds.push(r.data.groupId)
  }
  log('INFO', 'groups', `${groupIds.length}개 분임`)

  // 3-b. 데모용 참가자 접속 키. 실제 participant row 는 /p/enter 입장 시 생성된다.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const demoKeys = []
  for (let i = 0; i < groupIds.length; i++) {
    const r = await call('delib.issue_participant_access_key', 'instructor', {
      sessionId,
      groupId: groupIds[i],
      rawKey: `${RUN_ID}-group-${i + 1}-participant`,
      expiresAt
    }, scope)
    demoKeys.push({ label: GROUPS[i].label, topic: GROUPS[i].topic, rawKey: r.data.rawKey })
  }
  log('INFO', 'access keys', `${demoKeys.length}개 데모 참가자 키 발급`)

  // 4. 참가자 24명 등록 + 그룹 배정 (p[i] → 그룹 i%4)
  const pids = []
  const pidsByGroup = [[], [], [], []]
  for (let i = 0; i < PARTICIPANTS; i++) {
    const r = await call('delib.register_participant', 'instructor', {
      sessionId, displayAlias: `주민 ${String(i + 1).padStart(2, '0')}`, anonHandle: `anon-${String(i + 1).padStart(2, '0')}`
    }, scope)
    const pid = r.data.participantId
    pids.push(pid)
    const g = i % 4
    await call('delib.assign_participant', 'instructor', { participantId: pid, groupId: groupIds[g] }, scope)
    pidsByGroup[g].push(pid)
  }
  log('INFO', 'participants', `${pids.length}명 등록·배정`)

  // 5. 라운드별 의견 제출 + 투표. 라운드는 순서대로 열어야 한다 —
  //    start_round 가 이전 active 라운드를 closed 로 내리므로, 각 라운드의 발언은 그 라운드가 active 일 때 제출.
  // r0 발언은 create_workshop 이 만든 오프닝 라운드에 묶는다 — 라운드별 결과판(consensus/divisive/minority)이
  // 오프닝에서도 채워지도록. r1/r2 는 start_round 가 반환하는 id 로 묶는다.
  const roundIds = { r0: openingRoundId, r1: null, r2: null }

  const moderatedTargets = []
  let voteCount = 0

  async function submitAndVote(stmt, stmtIndex, roundId) {
    const author = pidsByGroup[stmt.g][stmtIndex % pidsByGroup[stmt.g].length]
    const res = await call('delib.submit_statement', 'instructor', {
      sessionId, roundId: roundId ?? undefined, groupId: groupIds[stmt.g],
      authorParticipantId: author, body: stmt.body
    }, scope)
    const statementId = res.data.statementId
    if (stmt.moderate) {
      moderatedTargets.push({ statementId, action: stmt.moderate })
      return
    }
    const plan = votePlan(stmtIndex, pids, { a: stmt.a, d: stmt.d, p: stmt.p })
    await pool(plan, CONCURRENCY, async (v) => {
      await call('delib.vote_statement', 'instructor', { statementId, participantId: v.pid, vote: v.vote }, scope)
    })
    voteCount += plan.length
  }

  // r0 (오프닝, roundId 없이 세션 스코프)
  let idx = 0
  for (const stmt of STATEMENTS.filter((s) => s.r === 'r0')) {
    await submitAndVote(stmt, idx++, roundIds.r0)
  }
  // r1 (분임 breakout) 열기
  const r1 = await call('delib.start_round', 'instructor', { sessionId, ...ROUNDS.r1 }, scope)
  roundIds.r1 = r1.data.roundId
  for (const stmt of STATEMENTS.filter((s) => s.r === 'r1')) {
    await submitAndVote(stmt, idx++, roundIds.r1)
  }
  // r2 (전체 종합 plenary) 열기
  const r2 = await call('delib.start_round', 'instructor', { sessionId, ...ROUNDS.r2 }, scope)
  roundIds.r2 = r2.data.roundId
  for (const stmt of STATEMENTS.filter((s) => s.r === 'r2')) {
    await submitAndVote(stmt, idx++, roundIds.r2)
  }
  log('INFO', 'statements', `${STATEMENTS.length}개 발언 · ${voteCount}표`)

  // 6. 모더레이션 시연 — 신고 처리 (visible → flagged). 큐 노출 + 집계 제외.
  for (const m of moderatedTargets) {
    await call('delib.moderate_statement', 'instructor', { statementId: m.statementId, action: m.action, reason: '부적절 발언 신고(데모)' }, scope)
  }
  log('INFO', 'moderation', `${moderatedTargets.length}건 신고 처리(flagged)`)

  // 7. 세션 전체 지형 스냅샷 계산 + 발행 (결과판 공개)
  const snap = await call('delib.compute_snapshot', 'instructor', { sessionId }, scope)
  await call('delib.publish_snapshot', 'instructor', { snapshotId: snap.data.snapshotId }, scope)
  log('INFO', 'snapshot', `발행 완료 (발언 ${snap.data.statementCount}개 집계)`)

  return { sessionId, participants: pids.length, statements: STATEMENTS.length, votes: voteCount, snapshotId: snap.data.snapshotId, demoKeys }
}

;(async () => {
  console.log(`run_id: ${RUN_ID}`)
  console.log(`base  : ${BASE}\n`)

  const health = await fetch(BASE + '/api/health').then((r) => r.json()).catch(() => null)
  if (!health?.ok) {
    log('FAIL', 'PRE', `서버 헬스체크 실패 — dev server 가 ${BASE} 에서 동작 중인지 확인 (npm run dev)`)
    process.exit(2)
  }
  log('INFO', 'PRE', `mode=${health.mode} service=${health.service}`)
  await fetchCsrf()
  log('INFO', 'PRE', 'CSRF 토큰 발급 완료')

  let result
  try {
    result = await seedDemo()
  } catch (e) {
    log('FAIL', 'RUN', e instanceof Error ? e.message : String(e))
    process.exit(1)
  }

  // 리포트는 LIVEOPS_OPERATOR_KEY 설정 시 operator 게이트로 보호된다(미들웨어+라우트 2차 검증).
  // health 는 게이트 상태를 노출하지 않으므로 안내 문구만 남긴다.
  const opGate = '(LIVEOPS_OPERATOR_KEY 설정 시 operator 로그인 필요)'
  console.log(`\n========================================`)
  console.log(`  숙의 워크숍 데모 시드 완료 (${health.mode})`)
  console.log(`========================================`)
  console.log(`sessionId       : ${result.sessionId}`)
  console.log(`참가자/의견/투표 : ${result.participants}명 / ${result.statements}개 / ${result.votes}표`)
  console.log(``)
  console.log(`운영자 콘솔      : ${BASE}/workshops/${result.sessionId}/console`)
  console.log(`워크숍 설정      : ${BASE}/workshops/${result.sessionId}/settings`)
  console.log(`프로젝터 결과판  : ${BASE}/workshops/${result.sessionId}/projector`)
  console.log(`참가자 입장      : ${BASE}/p/enter`)
  console.log(`참가자 데모 키   : ${result.demoKeys[0]?.rawKey ?? '(발급 실패)'}`)
  for (const key of result.demoKeys) {
    console.log(`  ${key.label.padEnd(4)} ${key.topic.padEnd(14)} ${key.rawKey}`)
  }
  console.log(``)
  console.log(`리포트 다운로드 ${opGate}:`)
  for (const fmt of ['md', 'html', 'xlsx']) {
    console.log(`  ${fmt.padEnd(4)}: ${BASE}/api/export/delib?sessionId=${result.sessionId}&format=${fmt}`)
  }
  console.log(``)
  console.log(`결과판 확인 포인트: consensus(합의)·divisive(쟁점)·minority(소수의견) 카드가 나타나고,`)
  console.log(`소표본 발언 2건은 k-익명 억제로 수치가 마스킹되며, 신고 발언 1건은 큐에만 보이고 집계에서 제외됩니다.`)
  process.exit(0)
})()
