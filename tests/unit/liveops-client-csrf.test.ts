import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

describe('liveops client mutation CSRF wiring', () => {
  it('timeline sync button uses apiFetch instead of raw fetch', () => {
    const cases = [
      ['components/liveops/TimelineSyncButton.tsx', '/api/timeline-sync']
    ] as const

    for (const [file, endpoint] of cases) {
      const src = read(file)
      expect(src).toContain("import { apiFetch } from '@/lib/api/fetcher'")
      expect(src).toContain(`apiFetch('${endpoint}'`)
      expect(src).not.toContain(`fetch('${endpoint}'`)
    }
  })

  it('new session creation selects the new /today board session', () => {
    const src = read('components/liveops/SessionCreateForm.tsx')
    expect(src).toContain("import { BOARD_COOKIE } from '@/lib/liveops/board-cookie'")
    expect(src).toContain('document.cookie')
    expect(src).toContain('/today?sessionId=')
  })
})
