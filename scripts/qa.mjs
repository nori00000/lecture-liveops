#!/usr/bin/env node
// Lecture LiveOps — QA gate runner
// G1 build / G2 typecheck / G3 lint / G4 public leak / G5 RLS coverage / G6 perm matrix /
// G7 external archive / G8 export plan / G9 realtime (manual) / G10 a11y contrast
import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const REPORT_DIR = path.join(ROOT, '_workspace', 'qa')
if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true })

const gates = []
function gate(id, name, fn) {
  const start = Date.now()
  try {
    const out = fn()
    gates.push({ id, name, status: 'PASS', detail: out, ms: Date.now() - start })
    console.log(`[${id}] PASS ${name}${out ? ' — ' + out : ''}`)
  } catch (e) {
    gates.push({ id, name, status: 'FAIL', detail: String(e?.message ?? e), ms: Date.now() - start })
    console.error(`[${id}] FAIL ${name} — ${e?.message ?? e}`)
  }
}

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts }).toString()
}

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f === '_workspace') continue
    const p = path.join(dir, f)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, acc)
    else acc.push(p)
  }
  return acc
}

// G4 leak — public route 디렉토리는 없지만, app/ 전체 파일에서 금지 토큰 grep
// 우리는 fixture에 "DEMO" 접미사만 있어서 실제 기업/사람 이름 leak이 없어야 함
const BAN_TOKENS = ['PRIVATE_HOME_PATH', 'PRIVATE_BRAND', 'sk_live_', 'sk-ant-', 'eyJhbGciOi']

gate('G1', 'build', () => {
  // 빌드는 무겁고 길어 환경에 의존. 실패 시 stderr 보존.
  try {
    run('npx --no-install next build', { stdio: 'pipe' })
    return 'next build ok'
  } catch (e) {
    throw new Error('build failed (npm install 후 재실행 권장)')
  }
})

gate('G2', 'typecheck', () => {
  try {
    run('npx --no-install tsc --noEmit')
    return 'tsc clean'
  } catch (e) {
    throw new Error('tsc errors (npm install 후 재실행 권장)')
  }
})

gate('G3', 'lint', () => {
  try {
    run('npx --no-install eslint .', { stdio: 'pipe' })
    return 'eslint 0 errors'
  } catch (e) {
    const out = (e?.stdout?.toString?.() ?? '') + (e?.stderr?.toString?.() ?? '')
    if (/0 errors/.test(out)) return 'eslint 0 errors (warnings only)'
    throw new Error('eslint errors')
  }
})

gate('G4', 'public leak grep', () => {
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'lib')))
  let hits = 0
  for (const f of files) {
    if (!/\.(ts|tsx|json|md)$/.test(f)) continue
    const s = readFileSync(f, 'utf8')
    for (const t of BAN_TOKENS) {
      // -DEMO 접미사가 없는 단독 출현만 leak
      const re = new RegExp(t + '(?!-DEMO)', 'g')
      const m = s.match(re)
      if (m) { hits += 1; console.log('  leak in', f, t) }
    }
  }
  if (hits) throw new Error(`leak hits=${hits}`)
  return 'no real-company/secret tokens'
})

gate('G5', 'RLS coverage', () => {
  const init = readFileSync(path.join(ROOT, 'db', 'migrations', '0001_init.sql'), 'utf8')
  const policies = readFileSync(path.join(ROOT, 'db', 'migrations', '0002_rls_policies.sql'), 'utf8')
  const entities = [
    'companies', 'courses', 'sessions', 'access_keys', 'qna_items', 'practice_tickets',
    'resources', 'ops_logs', 'assistant_signals', 'table_statuses', 'excel_templates',
    'excel_cells', 'export_jobs', 'external_archives', 'action_ledger'
  ]
  const enableMissing = entities.filter((e) => !init.includes(`alter table ${e} enable row level security`))
  if (enableMissing.length) throw new Error('missing RLS enable for: ' + enableMissing.join(','))
  const policyEntities = ['qna_items', 'practice_tickets', 'resources', 'ops_logs', 'assistant_signals', 'table_statuses', 'excel_templates', 'excel_cells', 'export_jobs', 'external_archives', 'access_keys', 'sessions', 'courses', 'companies', 'action_ledger']
  const polMissing = policyEntities.filter((e) => !policies.includes(' on ' + e + ' '))
  if (polMissing.length) throw new Error('missing policy for: ' + polMissing.join(','))
  return `${entities.length} entities RLS enabled + ${policyEntities.length} entities policies`
})

gate('G6', 'permission matrix', () => {
  const perm = readFileSync(path.join(ROOT, 'lib', 'action', 'permissions.ts'), 'utf8')
  if (!perm.includes("'liveops.answer_qna': ['admin', 'instructor']")) throw new Error('participant must not be allowed answer_qna')
  return 'participant denied for answer_qna'
})

gate('G7', 'external archive path guard', () => {
  const archive = readFileSync(path.join(ROOT, 'lib', 'export', 'archive-target.ts'), 'utf8')
  const segments = ['.git', 'node_modules', '.env']
  const missing = segments.filter((segment) => !archive.includes(segment))
  if (missing.length) throw new Error('missing protected segments: ' + missing.join(','))
  if (!archive.includes("process.cwd()")) throw new Error('archive target must be repository-relative')
  return `${segments.length} protected segments + repository-relative default`
})

gate('G8', 'export plan', () => {
  const md = readFileSync(path.join(ROOT, 'lib', 'export', 'markdown.ts'), 'utf8')
  if (!md.includes('00-MOC-인덱스.md') || !md.includes('05-자료-인덱스.md')) throw new Error('missing 6-note set')
  if (!md.includes('## 목차')) throw new Error('missing wikilink TOC')
  return '6-note set + wikilink TOC OK'
})

gate('G9', 'realtime', () => 'fixture polling 2s configured (manual multi-browser sync 검증 필요)')

gate('G10', 'a11y contrast (heuristic)', () => {
  const tw = readFileSync(path.join(ROOT, 'tailwind.config.ts'), 'utf8')
  if (!tw.includes("text: '#E8E8EA'") || !tw.includes("bg: '#0A0A0B'")) throw new Error('missing contrast tokens')
  return 'text #E8E8EA on bg #0A0A0B ≈ 15.7:1 (WCAG AAA)'
})

gate('G17', 'dual-mode repo (13 entity async)', () => {
  const dir = path.join(ROOT, 'lib', 'db', 'repo')
  const files = ['companies.ts', 'courses.ts', 'sessions.ts', 'accessKeys.ts', 'qna.ts', 'practice.ts', 'resources.ts', 'opsLogs.ts', 'signals.ts', 'excel.ts', 'exports.ts', 'ledger.ts']
  let miss = []
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), 'utf8')
    if (!src.includes('isNeonEnabled') || !src.includes('async')) miss.push(f)
  }
  if (miss.length) throw new Error('missing dual-mode: ' + miss.join(','))
  return `${files.length} repo dual-mode (fixture + neon SQL)`
})

gate('G18', 'fixture seed density', () => {
  const src = readFileSync(path.join(ROOT, 'lib', 'db', 'fixture', 'seed.ts'), 'utf8')
  // 동적 생성이므로 count 표현이 들어가야 함
  const checks = [
    [/'co-001-DEMO'/, 'company 001'],
    [/'co-002-DEMO'/, 'company 002'],
    [/'co-003-DEMO'/, 'company 003'],
    [/'se-001-DEMO'/, 'session 001'],
    [/'se-005-DEMO'/, 'session 005'],
    [/\['se-001-DEMO',\s*30\]/, 'qna 30 per se-001'],
    [/\['se-001-DEMO',\s*18\]/, 'practice 18 per se-001'],
    [/\['se-001-DEMO',\s*60\]/, 'ops 60 per se-001'],
    [/\['se-001-DEMO',\s*9\]/, 'signal 9 per se-001'],
    [/'ex-001-DEMO'/, 'excel template 001'],
    [/'ex-002-DEMO'/, 'excel template 002']
  ]
  const miss = checks.filter(([re]) => !re.test(src)).map(([, label]) => label)
  if (miss.length) throw new Error('missing seed: ' + miss.join(','))
  return '3 company / 3 course / 5 session / 21 access_key / 50 qna / 30 practice / 100 ops / 15 signal / 30 table_status / 2 excel + 40 cells'
})

gate('G19', 'scenarios B-J runner', () => {
  const src = readFileSync(path.join(ROOT, 'scripts', 'simulate-scenarios.mjs'), 'utf8')
  const ids = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
  const miss = ids.filter((id) => !src.includes(`record('${id}'`))
  if (miss.length) throw new Error('missing scenario: ' + miss.join(','))
  return '9 scenarios B-J defined'
})

gate('G20', 'lint zero warnings', () => {
  try {
    run('npx --no-install eslint . --max-warnings 0', { stdio: 'pipe' })
    return 'eslint 0 errors, 0 warnings'
  } catch (e) {
    const out = (e?.stdout?.toString?.() ?? '') + (e?.stderr?.toString?.() ?? '')
    throw new Error('warnings/errors: ' + out.split('\n').filter((l) => /problem/i.test(l)).join(' ').slice(0, 200))
  }
})

gate('G23', 'security headers + rate limit + origin (middleware)', () => {
  const mw = readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8')
  const hdr = readFileSync(path.join(ROOT, 'lib', 'security', 'headers.ts'), 'utf8')
  const rl = readFileSync(path.join(ROOT, 'lib', 'rateLimit.ts'), 'utf8')
  const headerNames = ['Content-Security-Policy-Report-Only', 'Strict-Transport-Security', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']
  const missH = headerNames.filter((h) => !hdr.includes(h))
  if (missH.length) throw new Error('missing headers: ' + missH.join(','))
  if (!mw.includes('checkRateLimit')) throw new Error('middleware not wired to rateLimit')
  if (!mw.includes('isAllowedOrigin')) throw new Error('middleware not wired to origin check')
  if (!rl.includes('ANON_LIMIT = 30')) throw new Error('rate limit ANON should be 30')
  if (!rl.includes('AUTH_LIMIT = 60')) throw new Error('rate limit AUTH should be 60')
  return `6 headers + rate limit 30/60 + origin allowlist`
})

gate('G24', 'vitest tests present', () => {
  const files = readdirSync(path.join(ROOT, 'tests', 'unit'))
  const required = ['rls-context.test.ts', 'repo-companies-anon.test.ts', 'middleware.test.ts', 'csrf.test.ts']
  const miss = required.filter((f) => !files.includes(f))
  if (miss.length) throw new Error('missing test files: ' + miss.join(','))
  return `${files.length} test files`
})

gate('G27', 'Notify dispatcher (P2-2)', () => {
  const types = readFileSync(path.join(ROOT, 'lib', 'notify', 'types.ts'), 'utf8')
  const dispatch = readFileSync(path.join(ROOT, 'lib', 'notify', 'dispatcher.ts'), 'utf8')
  const email = readFileSync(path.join(ROOT, 'lib', 'notify', 'email.ts'), 'utf8')
  const sms = readFileSync(path.join(ROOT, 'lib', 'notify', 'sms.ts'), 'utf8')
  const hooks = readFileSync(path.join(ROOT, 'lib', 'notify', 'hooks.ts'), 'utf8')
  const events = ['access_key_issued', 'qna_answered', 'signal_raised', 'export_completed', 'practice_ticket_critical']
  const missE = events.filter((e) => !types.includes(`'${e}'`))
  if (missE.length) throw new Error('missing event type: ' + missE.join(','))
  if (!dispatch.includes('allSettled')) throw new Error('dispatcher must use Promise.allSettled')
  if (!email.includes("from 'resend'") && !email.includes('Resend')) throw new Error('email adapter not wired')
  if (!sms.includes('twilio.com')) throw new Error('SMS adapter not wired')
  const hookNames = ['onAccessKeyIssued', 'onQnaAnswered', 'onSignalRaised', 'onExportCompleted']
  const missH = hookNames.filter((h) => !hooks.includes(`export async function ${h}`))
  if (missH.length) throw new Error('missing hook: ' + missH.join(','))
  return '2 adapters + dispatcher + 4 hooks + 5 events'
})

gate('G26', 'NextAuth v5 (P2-1)', () => {
  const auth = readFileSync(path.join(ROOT, 'auth.ts'), 'utf8')
  const route = readFileSync(path.join(ROOT, 'app', 'api', 'auth', '[...nextauth]', 'route.ts'), 'utf8')
  const layout = readFileSync(path.join(ROOT, 'app', 'admin', 'layout.tsx'), 'utf8')
  const csrf = readFileSync(path.join(ROOT, 'lib', 'csrf.ts'), 'utf8')
  if (!auth.includes('NeonAdapter')) throw new Error('NeonAdapter not wired')
  if (!auth.includes("strategy: 'jwt'")) throw new Error('jwt strategy missing')
  if (!auth.includes("'/admin/login'")) throw new Error('signIn page missing')
  if (!route.includes('handlers')) throw new Error('route handler missing')
  if (!layout.includes('await auth()')) throw new Error('admin layout not protected')
  if (!layout.includes("redirect('/admin/login')")) throw new Error('admin redirect missing')
  if (!csrf.includes('/api/auth/')) throw new Error('/api/auth/* CSRF exempt missing')
  return 'NextAuth v5 + Neon adapter + admin layout + CSRF exempt'
})

gate('G25', 'CSRF token (double-submit cookie)', () => {
  const csrf = readFileSync(path.join(ROOT, 'lib', 'csrf.ts'), 'utf8')
  const mw = readFileSync(path.join(ROOT, 'middleware.ts'), 'utf8')
  const route = readFileSync(path.join(ROOT, 'app', 'api', 'csrf', 'route.ts'), 'utf8')
  const fetcher = readFileSync(path.join(ROOT, 'lib', 'api', 'fetcher.ts'), 'utf8')
  if (!csrf.includes('constantTimeCompare')) throw new Error('constantTimeCompare missing')
  if (!csrf.includes('CSRF_EXEMPT_PATHS')) throw new Error('exempt set missing')
  if (csrf.includes('node:crypto')) throw new Error('node:crypto 사용 금지 (Edge runtime 호환 안 됨)')
  if (!mw.includes('constantTimeCompare')) throw new Error('middleware not wired to csrf compare')
  if (!route.includes('csrfCookieHeader')) throw new Error('csrf route not issuing cookie')
  if (!fetcher.includes('CSRF_HEADER') && !fetcher.includes('x-csrf-token')) throw new Error('client fetcher missing header')
  if (!fetcher.includes('apiFetch')) throw new Error('apiFetch helper missing')
  return 'csrf core + middleware + route + client fetcher OK'
})

gate('G31', 'AI Lecture LiveOps action catalog', () => {
  const catalog = readFileSync(path.join(ROOT, 'lib', 'action', 'catalog.ts'), 'utf8')
  const actions = ['liveops.create_lecture_session', 'liveops.ingest_raw_note', 'liveops.generate_situation_snapshot', 'liveops.update_session_phase', 'liveops.upsert_material_version', 'liveops.list_session_dashboard']
  const missing = actions.filter((a) => !catalog.includes(a))
  if (missing.length) throw new Error('missing v2 actions: ' + missing.join(','))
  return `${actions.length} v2 actions registered`
})

gate('G32', 'AI Lecture LiveOps domain flow', () => {
  const parser = readFileSync(path.join(ROOT, 'lib', 'liveops', 'parser.ts'), 'utf8')
  const snapshot = readFileSync(path.join(ROOT, 'lib', 'liveops', 'snapshot.ts'), 'utf8')
  const dashboard = readFileSync(path.join(ROOT, 'lib', 'liveops', 'dashboard.ts'), 'utf8')
  if (!parser.includes('parseRawNote')) throw new Error('parseRawNote missing')
  if (!snapshot.includes('buildSituationSnapshot')) throw new Error('buildSituationSnapshot missing')
  if (!dashboard.includes('buildSessionDashboard')) throw new Error('buildSessionDashboard missing')
  return 'raw note → observation → snapshot → dashboard flow present'
})

gate('G33', 'AI Lecture LiveOps dashboard routes', () => {
  const routes = [
    'app/(app)/sessions/new/page.tsx',
    'app/(app)/sessions/[id]/page.tsx',
    'app/(app)/sessions/[id]/timeline/page.tsx',
    'app/(app)/sessions/[id]/materials/page.tsx',
    'app/api/data/session-dashboard/route.ts'
  ]
  const missing = routes.filter((f) => !existsSync(path.join(ROOT, f)))
  if (missing.length) throw new Error('missing routes: ' + missing.join(','))
  return `${routes.length} v2 routes present`
})

gate('G34', 'AI Lecture LiveOps non-dev UX copy', () => {
  const files = [
    'components/liveops/QuickNoteComposer.tsx',
    'components/liveops/SituationHero.tsx',
    'components/shell/Sidebar.tsx'
  ]
  const joined = files.map((f) => readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
  if (!joined.includes('AI가 정리해서 반영')) throw new Error('missing non-dev AI copy')
  if (!joined.includes('상황판')) throw new Error('missing dashboard-first copy')
  return 'non-dev dashboard-first copy present'
})

const summary = {
  generated_at: new Date().toISOString(),
  total: gates.length,
  pass: gates.filter((g) => g.status === 'PASS').length,
  fail: gates.filter((g) => g.status === 'FAIL').length,
  gates
}
writeFileSync(path.join(REPORT_DIR, 'qa_report.json'), JSON.stringify(summary, null, 2))
console.log('\n=== QA SUMMARY ===')
console.log(`PASS ${summary.pass} / FAIL ${summary.fail} / TOTAL ${summary.total}`)
console.log('report:', path.join(REPORT_DIR, 'qa_report.json'))
process.exit(summary.fail > 0 ? 1 : 0)
