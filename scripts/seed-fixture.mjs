#!/usr/bin/env node
// fixture seed counts 출력
import { readFileSync } from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const seedSrc = readFileSync(path.join(ROOT, 'lib', 'db', 'fixture', 'seed.ts'), 'utf8')
function count(name) {
  const re = new RegExp(`export const ${name}[^=]*=\\s*\\[`)
  const m = seedSrc.match(re)
  if (!m) return 0
  // 단순 count: 첫 매치 뒤 } 갯수 (대략적)
  const tail = seedSrc.slice(m.index)
  const end = tail.indexOf('\nexport const ')
  const chunk = end >= 0 ? tail.slice(0, end) : tail
  return (chunk.match(/\{/g) ?? []).length - 1
}
const entities = ['seedCompanies', 'seedCourses', 'seedSessions', 'seedAccessKeys', 'seedQna', 'seedPractice', 'seedResources', 'seedOpsLogs', 'seedSignals', 'seedTableStatuses', 'seedExcelTemplates', 'seedExcelCells']
for (const e of entities) console.log(e.padEnd(20), count(e))
