/**
 * 숙의 도메인 XSS 회귀 테스트 (N6).
 * 발언 body / display_alias / 워크숍 title 에 마크업·스크립트·RTL override 를 주입해도
 * 참가자/콘솔/프로젝터 렌더가 이를 "실행 가능한 HTML"이 아니라 텍스트로만 출력하는지 검증한다.
 *
 * 근거: 이 화면들은 사용자 텍스트를 JSX `{value}` 자식으로만 렌더한다(React 자동 이스케이프).
 *  - 여기서는 (1) 렌더 계약(이스케이프)과 (2) 뷰 빌더가 원문을 변형하지 않음을 검증하고,
 *  - (3) 소스에 dangerouslySetInnerHTML 가 재도입되지 않았는지 정적 스캔으로 방어한다.
 *
 * vitest 환경은 node 이므로 JSX 대신 React.createElement 를 사용한다(.test.ts).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { toStatementCard, toConsoleCard } from '@/lib/delib/views'
import type { Statement } from '@/lib/db/schema'

const ROOT = path.resolve(__dirname, '..', '..')

// 공격 fixture — HTML 인젝션 2종 + RTL override 1종.
const FIXTURES = [
  '<img src=x onerror=alert(1)>',
  '<script>alert(document.cookie)</script>',
  '‮evil-rtl-override'
]

function mkStatement(body: string): Statement {
  return {
    id: 'st-xss',
    session_id: 'se-001-DEMO',
    round_id: null,
    group_id: null,
    author_participant_id: null,
    body,
    visibility: 'group',
    moderation_state: 'visible',
    created_at: '2026-07-22T00:00:00.000Z'
  } as Statement
}

describe('delib XSS 회귀 — 사용자 텍스트는 텍스트로만 렌더', () => {
  it('발언 body / alias / title 을 JSX 자식으로 렌더하면 HTML 이 이스케이프된다', () => {
    for (const raw of FIXTURES) {
      // 페이지들이 사용자 텍스트를 렌더하는 실제 패턴: <p>{body}</p>, <h1>{title}</h1>, <span>{alias}</span>
      for (const el of [
        React.createElement('p', null, raw),
        React.createElement('h1', null, raw),
        React.createElement('span', null, raw)
      ]) {
        const html = renderToStaticMarkup(el)
        // 실행 가능한 태그가 그대로 들어가면 안 된다.
        expect(html).not.toContain('<script>')
        expect(html).not.toContain('<img src=x onerror=')
        // '<' 를 포함한 fixture 는 &lt; 로 이스케이프되어야 한다.
        if (raw.includes('<')) {
          expect(html).toContain('&lt;')
          expect(html).not.toContain('<img')
          expect(html).not.toContain('<script')
        }
      }
    }
  })

  it('뷰 빌더(toStatementCard/toConsoleCard)는 body 원문을 변형·이스케이프하지 않고 그대로 전달한다', () => {
    // 이스케이프는 렌더 시점(React)의 책임 — 빌더가 이중처리하거나 원문을 왜곡하지 않아야 한다.
    for (const raw of FIXTURES) {
      const s = mkStatement(raw)
      expect(toStatementCard(s).body).toBe(raw)
      expect(toConsoleCard(s).body).toBe(raw)
    }
  })

  it('숙의 렌더 파일에 dangerouslySetInnerHTML 이 재도입되지 않았다 (정적 스캔)', () => {
    const files = [
      'app/p/workshop/page.tsx',
      'app/(app)/workshops/[id]/console/page.tsx',
      'app/workshops/[id]/projector/page.tsx',
      'app/(app)/workshops/[id]/settings/page.tsx',
      'lib/delib/views.ts',
      'components/delib/VoteControls.tsx'
    ]
    for (const f of files) {
      const src = readFileSync(path.join(ROOT, f), 'utf8')
      expect(src, f).not.toContain('dangerouslySetInnerHTML')
    }
  })
})
