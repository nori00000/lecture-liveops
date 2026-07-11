#!/usr/bin/env node
// Lecture LiveOps MCP smoke (stdio client)
// 본 스크립트는 MCP server를 child process로 띄우고 jsonrpc로 tools/list + liveops.get_today_session 호출.
// 전제: dev/prod server가 http://localhost:3010 (또는 LIVEOPS_BASE_URL)에서 동작 중.

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(new URL('..', import.meta.url).pathname)
const OUT_DIR = path.join(ROOT, '_workspace', 'mcp')
mkdirSync(OUT_DIR, { recursive: true })
const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'

const child = spawn('node', [path.join(ROOT, 'mcp', 'server.mjs')], {
  env: { ...process.env, LIVEOPS_BASE_URL: BASE },
  stdio: ['pipe', 'pipe', 'pipe']
})

let buf = ''
const pending = new Map()
let nextId = 1

child.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  const lines = buf.split('\n')
  buf = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve } = pending.get(msg.id)
      pending.delete(msg.id)
      resolve(msg)
    }
  }
})
child.stderr.on('data', (c) => process.stderr.write('[server] ' + c.toString()))

function send(method, params) {
  return new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    const req = { jsonrpc: '2.0', id, method, params }
    child.stdin.write(JSON.stringify(req) + '\n')
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error('timeout for ' + method))
      }
    }, 10000)
  })
}

;(async () => {
  // initialize
  const initRes = await send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'ax-smoke', version: '0.1.0' }
  })
  // notifications/initialized
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n')

  const listRes = await send('tools/list', {})
  const tools = listRes?.result?.tools ?? []

  const callRes = await send('tools/call', {
    name: 'liveops.get_today_session',
    arguments: { __meta: { role: 'admin' } }
  })
  const callText = callRes?.result?.content?.[0]?.text ?? ''
  let callBody = null
  try { callBody = JSON.parse(callText) } catch {}

  const summary = {
    base: BASE,
    initialized: !!initRes?.result,
    tools_count: tools.length,
    tools_names: tools.map((t) => t.name),
    sample_call: 'liveops.get_today_session',
    sample_call_ok: callBody?.ok === true,
    sample_call_session_id: callBody?.data?.id ?? null,
    sample_call_status: callBody?.status ?? null,
    completed_at: new Date().toISOString()
  }
  writeFileSync(path.join(OUT_DIR, 'smoke.json'), JSON.stringify(summary, null, 2))

  console.log('\n=== MCP SMOKE ===')
  console.log('initialized   :', summary.initialized)
  console.log('tools count   :', summary.tools_count)
  console.log('sample call ok:', summary.sample_call_ok, '→', summary.sample_call_session_id)
  console.log('saved         :', path.join(OUT_DIR, 'smoke.json'))

  child.kill('SIGTERM')
  const ok = summary.initialized && summary.tools_count >= 15 && summary.sample_call_ok
  process.exit(ok ? 0 : 1)
})()
