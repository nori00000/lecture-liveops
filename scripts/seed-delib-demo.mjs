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

// 참가자 신원으로 액션을 호출한다 (participant 세션 쿠키 동반).
// Q1 근거 유형은 **참가자 본인이 고른 값**으로만 저장된다 — operator 대리입력 경로에서는 서버가
// evidence_kind 를 null 로 강제하기 때문에(§5 지표 오염 방지), 데모가 Q1 을 보여주려면
// 실제 참가자 세션으로 제출해야 한다. 이 가드를 우회하지 않고 정식 경로를 그대로 쓴다.
async function callAsParticipant(cookie, action, input, scope = {}) {
  const envelope = {
    action,
    actor: { type: 'human', role: 'participant', tool: 'web-ui' },
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
        cookie: `liveops_csrf=${CSRF_TOKEN}; ${cookie}`,
        'x-csrf-token': CSRF_TOKEN
      },
      body: JSON.stringify(envelope)
    })
    const body = await res.json().catch(() => null)
    if (res.status === 200 && body?.ok !== false) return body
    if (res.status === 429 && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(res, attempt))
      continue
    }
    throw new Error(`${action}(participant) 실패 (status ${res.status}): ${body?.error ?? 'unknown'}`)
  }
  throw new Error(`${action}(participant) 실패: retry exhausted`)
}

// 접속 키로 실제 입장 → participant 세션 쿠키 + participantId 확보.
// /p/enter 가 access_key 당 participant 1개를 서버에서 만들고 scope.groupId 그룹에 배정한다.
async function enterAsParticipant(rawKey) {
  const res = await fetch(BASE + '/api/p/enter', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: BASE,
      cookie: `liveops_csrf=${CSRF_TOKEN}`,
      'x-csrf-token': CSRF_TOKEN
    },
    body: JSON.stringify({ accessKey: rawKey })
  })
  const body = await res.json().catch(() => null)
  if (res.status !== 200 || body?.ok !== true) {
    throw new Error(`participant 입장 실패 (status ${res.status}): ${body?.error ?? 'unknown'}`)
  }
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') ?? '']
  const cookie = raw
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith(`${PARTICIPANT_COOKIE}=`))
  if (!cookie) throw new Error(`participant 세션 쿠키(${PARTICIPANT_COOKIE}) 미발급`)
  // 투표는 operator 대리 경로를 쓰므로 participantId 가 필요하다 — 본인 화면 API 에서 받는다.
  const meRes = await fetch(`${BASE}/api/data/delib/participant-view`, {
    headers: { cookie: `liveops_csrf=${CSRF_TOKEN}; ${cookie}` }
  })
  const me = await meRes.json().catch(() => null)
  if (!me?.participantId) throw new Error('participant 신원 조회 실패')
  return { cookie, participantId: me.participantId }
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
// 그룹당 발언 저자 수. Q1 근거 유형 분포는 그룹 기여자가 3명 미만이면 억제되므로(개인 태깅 역추론 방지)
// 데모가 Q1 을 실제로 보여주려면 그룹당 최소 3명이 필요하다.
const AUTHORS_PER_GROUP = 3
// lib/participantSession.ts 의 PARTICIPANT_SESSION_COOKIE 와 같아야 한다 (스크립트는 앱 모듈을 import 하지 않음).
const PARTICIPANT_COOKIE = 'liveops_participant_session'
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

// 의견 22개. r=라운드 키(r0=오프닝), g=그룹 index(0~3), a/d/p=찬성/반대/유보 표수(고정),
// ev=Q1 근거 유형(참가자 본인 선택: experience|source|estimate, 생략=미지정).
// moderate: 'flag' 이면 제출 후 신고 처리 → 모더레이션 큐에 노출되고 집계에서 제외.
// 설계 의도:
//   consensus(합의점, 찬성 우세): S1·S5·S10·S13·S14 (찬성 쪽 강한 쏠림)
//   opposed(반대 합의, 반대 우세): S3·S7·S8 (반대 쪽 강한 쏠림 — 합의점과 섞이면 안 되는 항목)
//   divisive(쟁점):  S2·S6 (찬반 팽팽)
//   minority(소수):  전체 다수 방향과 반대인 발언에 자동 flag
//   k-익명 억제:     S11·S15 (총 2표 → 개인 표 역추론 위험, 수치 마스킹)
//   moderation:      S12 (신고 → 큐 노출·집계 제외)
//   Q1 분포:         r1 은 그룹마다 발언 4건·저자 3명 이상 → 근거 유형 분포가 억제되지 않고 표시된다.
//                    "추정" 비율이 5~80% 구간(사전등록 임계) 안에 들도록 섞었다.
const STATEMENTS = [
  { key: 'S1', r: 'r0', g: 0, a: 18, d: 3, p: 1, ev: 'experience', body: '평일 저녁 9시까지 개관 시간을 연장하는 것이 가장 시급하다.' },
  { key: 'S2', r: 'r0', g: 1, a: 11, d: 10, p: 2, ev: 'estimate', body: '주말 개관을 오전 9시로 앞당기자.' },
  { key: 'S3', r: 'r0', g: 3, a: 5, d: 14, p: 2, ev: 'source', body: '예산 한계상 야간 연장은 비현실적이므로 반대한다.' },
  // r1 분임 — 그룹마다 4건(저자 3명 이상). Q1 근거 유형 분포가 그룹 단위로 표시되는 최소 조건.
  { key: 'S4', r: 'r1', g: 0, a: 15, d: 4, p: 1, ev: 'experience', body: '열람실만 야간에 연장 개방하고 나머지 층은 정시 마감하자.' },
  { key: 'S8', r: 'r1', g: 0, a: 4, d: 16, p: 1, ev: 'estimate', body: '라운지를 24시간 개방해 심야 자율 학습 공간으로 쓰자.' },
  { key: 'S16', r: 'r1', g: 0, a: 13, d: 6, p: 2, ev: 'source', body: '인근 도서관 야간 이용 통계를 보면 저녁 7~9시 이용자가 가장 많다.' },
  { key: 'S17', r: 'r1', g: 0, a: 8, d: 11, p: 2, ev: 'estimate', body: '야간 연장은 이용자보다 직원 부담이 더 커질 것 같다.' },
  { key: 'S7', r: 'r1', g: 1, a: 6, d: 13, p: 2, ev: 'estimate', body: '일요일 휴관을 폐지하고 연중무휴로 운영하자.' },
  { key: 'S12', r: 'r1', g: 1, a: 0, d: 0, p: 0, moderate: 'flag', body: '[신고 예시] 특정 이용자를 비난하는 부적절 발언 — 모더레이션 시연용.' },
  { key: 'S18', r: 'r1', g: 1, a: 16, d: 4, p: 1, ev: 'experience', body: '토요일 오전에 아이와 왔다가 자리가 없어 돌아간 적이 여러 번 있다.' },
  { key: 'S19', r: 'r1', g: 1, a: 10, d: 9, p: 2, ev: 'source', body: '조례상 공휴일 운영은 관장 재량이라 예산만 확보되면 가능하다.' },
  { key: 'S6', r: 'r1', g: 2, a: 9, d: 9, p: 3, ev: 'estimate', body: '청소년 전용 이용 시간대를 신설하자.' },
  { key: 'S10', r: 'r1', g: 2, a: 14, d: 3, p: 1, ev: 'experience', body: '조용한 열람실을 확대해 달라는 요구가 많다.' },
  { key: 'S11', r: 'r1', g: 2, a: 1, d: 1, p: 0, ev: 'estimate', body: '특정 소모임만을 위한 심야 개방을 요청한다.' }, // 총 2표 → 억제
  { key: 'S20', r: 'r1', g: 2, a: 12, d: 8, p: 1, ev: 'source', body: '청소년 이용 통계는 시험기간에만 몰려 상시 전용 시간대 근거는 약하다.' },
  { key: 'S5', r: 'r1', g: 3, a: 17, d: 2, p: 2, ev: 'source', body: '무인 반납·대출기를 도입해 인건비를 줄이면 연장 여력이 생긴다.' },
  { key: 'S9', r: 'r1', g: 3, a: 12, d: 7, p: 2, ev: 'estimate', body: '지역 자원봉사자를 활용해 저녁 시간대를 운영하자.' },
  { key: 'S21', r: 'r1', g: 3, a: 5, d: 15, p: 1, ev: 'experience', body: '자원봉사자에게 야간 운영을 맡겼다가 사고가 났던 사례를 들었다.' },
  { key: 'S22', r: 'r1', g: 3, a: 14, d: 5, p: 2, ev: 'experience', body: '무인기 도입 후 반납 대기줄이 줄어든 것을 직접 봤다.' },
  { key: 'S13', r: 'r2', g: 0, a: 20, d: 2, p: 1, ev: 'experience', body: '최우선 과제로 평일 야간 연장을 채택하자.' },
  { key: 'S14', r: 'r2', g: 3, a: 16, d: 3, p: 2, ev: 'source', body: '시 예산 확보를 위한 주민 청원을 진행하자.' },
  { key: 'S15', r: 'r2', g: 2, a: 2, d: 0, p: 0, ev: 'experience', body: '야간 연장에 반대하는 소수 입장도 회의록에 남기자.' } // 총 2표 → 억제
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

  // 3-b. 데모용 참가자 접속 키 — 그룹당 AUTHORS_PER_GROUP 개.
  // 이 키로 입장한 참가자가 **발언 저자**가 된다(Q1 근거 유형은 본인 선택 값만 저장되므로).
  // 그룹당 3명 이상이어야 근거 유형 분포가 k-익명 억제에 걸리지 않고 표시된다.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const demoKeys = []
  const keysByGroup = [[], [], [], []]
  for (let i = 0; i < groupIds.length; i++) {
    for (let n = 0; n < AUTHORS_PER_GROUP; n++) {
      const r = await call('delib.issue_participant_access_key', 'instructor', {
        sessionId,
        groupId: groupIds[i],
        rawKey: `${RUN_ID}-group-${i + 1}-participant-${n + 1}`,
        expiresAt
      }, scope)
      keysByGroup[i].push(r.data.rawKey)
      // 배포용 안내에는 그룹당 대표 키 1개만 싣는다(나머지는 같은 규칙의 -2, -3).
      if (n === 0) demoKeys.push({ label: GROUPS[i].label, topic: GROUPS[i].topic, rawKey: r.data.rawKey })
    }
  }
  log('INFO', 'access keys', `${groupIds.length * AUTHORS_PER_GROUP}개 데모 참가자 키 발급 (그룹당 ${AUTHORS_PER_GROUP})`)

  // 4-a. 저자 참가자 — 접속 키로 실제 입장. participant row 생성·그룹 배정은 /p/enter 가 한다.
  const authorsByGroup = [[], [], [], []]
  const pids = []
  for (let g = 0; g < keysByGroup.length; g++) {
    for (const rawKey of keysByGroup[g]) {
      const who = await enterAsParticipant(rawKey)
      authorsByGroup[g].push(who)
      pids.push(who.participantId)
    }
  }
  log('INFO', 'authors', `${pids.length}명 접속 키로 입장 (발언 저자)`)

  // 4-b. 나머지 참가자는 운영자 등록(투표자). 저자 + 투표자 = PARTICIPANTS 명.
  for (let i = pids.length; i < PARTICIPANTS; i++) {
    const r = await call('delib.register_participant', 'instructor', {
      sessionId, displayAlias: `주민 ${String(i + 1).padStart(2, '0')}`, anonHandle: `anon-${String(i + 1).padStart(2, '0')}`
    }, scope)
    const pid = r.data.participantId
    pids.push(pid)
    await call('delib.assign_participant', 'instructor', { participantId: pid, groupId: groupIds[i % 4] }, scope)
  }
  log('INFO', 'participants', `${pids.length}명 등록·배정`)

  // 5. 라운드별 의견 제출 + 투표. 라운드는 순서대로 열어야 한다 —
  //    start_round 가 이전 active 라운드를 closed 로 내리므로, 각 라운드의 발언은 그 라운드가 active 일 때 제출.
  // r0 발언은 create_workshop 이 만든 오프닝 라운드에 묶는다 — 라운드별 결과판(consensus/divisive/minority)이
  // 오프닝에서도 채워지도록. r1/r2 는 start_round 가 반환하는 id 로 묶는다.
  const roundIds = { r0: openingRoundId, r1: null, r2: null }

  const moderatedTargets = []
  let voteCount = 0

  // 그룹별 저자 회전 커서. 전역 index 로 돌리면 그룹마다 저자가 겹쳐 기여자 수가 3 미만으로 떨어지고,
  // 그러면 근거 유형 분포가 차분공격 방어(연쇄 억제)에 걸려 라운드 전체가 마스킹된다.
  // 신고 예정 발언은 visible 집계에서 빠지므로 커서를 진행시키지 않는다 — 그 자리도 저자 1명을 소모하면
  // 남은 visible 발언의 저자가 2명으로 줄어든다.
  const authorCursor = [0, 0, 0, 0]

  async function submitAndVote(stmt, stmtIndex, roundId) {
    // 참가자 본인 신원으로 제출한다 — groupId 는 서버가 membership 에서 강제하므로 보내지 않는다.
    const authors = authorsByGroup[stmt.g]
    const author = authors[authorCursor[stmt.g] % authors.length]
    if (!stmt.moderate) authorCursor[stmt.g] += 1
    const res = await callAsParticipant(author.cookie, 'delib.submit_statement', {
      sessionId, roundId: roundId ?? undefined, body: stmt.body,
      ...(stmt.ev ? { evidenceKind: stmt.ev } : {})
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
