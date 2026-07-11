#!/usr/bin/env node
// Lecture LiveOps MCP server (stdio)
// MVP 15 + 좌석/신호 4 = 19 action을 MCP tool로 노출. 내부적으로 /api/action HTTP endpoint 호출.
// 안전: 외부 endpoint 호출 0. LIVEOPS_BASE_URL는 localhost 또는 사용자 명시 internal URL만.
// 사용: claude mcp add ax-liveops node /path/to/mcp/server.mjs

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const BASE = process.env.LIVEOPS_BASE_URL ?? 'http://localhost:3010'

const TOOLS = [
  {
    name: 'liveops.get_today_session',
    description: '오늘 강의 세션을 조회한다. 인자가 비어 있으면 최신 live 세션을 반환.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD (선택)' },
        companyId: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.add_qna',
    description: '참가자 질문을 추가한다.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'body'],
      properties: {
        sessionId: { type: 'string' },
        body: { type: 'string' },
        authorLabel: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'string', enum: ['low', 'normal', 'high'] }
      }
    }
  },
  {
    name: 'liveops.answer_qna',
    description: '강사가 질문에 답변한다. role=instructor 이상 필요.',
    inputSchema: {
      type: 'object',
      required: ['qnaId', 'answer'],
      properties: {
        qnaId: { type: 'string' },
        answer: { type: 'string' },
        status: { type: 'string', enum: ['answered', 'needs_follow_up', 'sent_to_company'] }
      }
    }
  },
  {
    name: 'liveops.update_qna_status',
    description: '질문 상태 변경 (triage 등).',
    inputSchema: {
      type: 'object',
      required: ['qnaId', 'status'],
      properties: {
        qnaId: { type: 'string' },
        status: { type: 'string', enum: ['new', 'triaged', 'answered', 'needs_follow_up', 'sent_to_company', 'archived'] }
      }
    }
  },
  {
    name: 'liveops.create_practice_ticket',
    description: '실습 도움 요청 티켓 생성.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'body'],
      properties: {
        sessionId: { type: 'string' },
        tableLabel: { type: 'string' },
        body: { type: 'string' },
        severity: { type: 'string', enum: ['low', 'normal', 'high', 'blocker'] }
      }
    }
  },
  {
    name: 'liveops.update_practice_ticket',
    description: '실습 티켓 상태 변경.',
    inputSchema: {
      type: 'object',
      required: ['ticketId', 'status'],
      properties: {
        ticketId: { type: 'string' },
        status: { type: 'string', enum: ['help_needed', 'assisting', 'solved', 'follow_up'] },
        note: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.upload_resource',
    description: '자료 업로드 등록.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'fileRef', 'resourceType'],
      properties: {
        sessionId: { type: 'string' },
        fileRef: { type: 'string' },
        resourceType: { type: 'string', enum: ['pdf', 'md', 'xlsx', 'image', 'link', 'html', 'prompt', 'code'] },
        visibility: { type: 'string', enum: ['public', 'session', 'private', 'admin_only'] },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'liveops.attach_link',
    description: '외부 링크 첨부.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'url', 'title'],
      properties: {
        sessionId: { type: 'string' },
        url: { type: 'string' },
        title: { type: 'string' },
        visibility: { type: 'string', enum: ['public', 'session', 'private', 'admin_only'] },
        tags: { type: 'array', items: { type: 'string' } }
      }
    }
  },
  {
    name: 'liveops.append_ops_log',
    description: '운영 로그 한 줄 기록.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'logType', 'body'],
      properties: {
        sessionId: { type: 'string' },
        logType: { type: 'string', enum: ['issue', 'mood', 'signal', 'question', 'progress', 'resource', 'note'] },
        body: { type: 'string' },
        visibility: { type: 'string', enum: ['public', 'session', 'private', 'admin_only'] }
      }
    }
  },
  {
    name: 'liveops.send_assistant_signal',
    description: '보조강사 신호 발송 (7종).',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'signalType'],
      properties: {
        sessionId: { type: 'string' },
        signalType: { type: 'string', enum: ['speed_down', 'break_needed', 'question_surge', 'practice_blocked', 'lunch_delay', 'network', 'mood_drop'] },
        tableLabel: { type: 'string' },
        note: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.acknowledge_signal',
    description: '강사가 보조강사 신호를 확인 처리한다 (acknowledged_at 기록).',
    inputSchema: {
      type: 'object',
      required: ['signalId'],
      properties: {
        signalId: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.update_table_status',
    description: '테이블 진행 상태 갱신.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'tableLabel', 'progress'],
      properties: {
        sessionId: { type: 'string' },
        tableLabel: { type: 'string' },
        progress: { type: 'string', enum: ['not_started', 'following', 'blocked', 'solved', 'waiting'] },
        blocker: { type: 'string' },
        assistantId: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.update_seat_mark',
    description: '좌석 신호등 보드의 좌석 1개를 문제(problem)/해결(resolved)/해제(none)로 표시하고 메모를 남긴다. (session_id, seat_key) upsert.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'seatKey', 'status'],
      properties: {
        sessionId: { type: 'string' },
        seatKey: { type: 'string', description: '레이아웃에 정의된 좌석 키 (예: T1-3)' },
        status: { type: 'string', enum: ['none', 'problem', 'resolved'] },
        reason: { type: 'string', description: '짧은 사유 (최대 20자)' },
        memo: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.upsert_seat_layout',
    description: '세션의 좌석 레이아웃(zones+tables, 0~100 viewBox 좌표)을 upsert한다. 세션당 active 1개.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'name', 'layout'],
      properties: {
        sessionId: { type: 'string' },
        name: { type: 'string' },
        layout: {
          type: 'object',
          required: ['zones', 'tables'],
          properties: {
            zones: {
              type: 'array',
              description: '화면/책상 등 배경 존',
              items: {
                type: 'object',
                required: ['id', 'label', 'kind', 'x', 'y', 'w', 'h'],
                properties: {
                  id: { type: 'string' },
                  label: { type: 'string' },
                  kind: { type: 'string', enum: ['screen', 'desk'] },
                  x: { type: 'number' },
                  y: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' }
                }
              }
            },
            tables: {
              type: 'array',
              description: 'round(cx,cy,r + seats.angleDeg) / rect(w,h) / tshape(w,h,stemW,stemH) 테이블',
              items: {
                type: 'object',
                required: ['label', 'cx', 'cy', 'seats'],
                properties: {
                  label: { type: 'string' },
                  kind: { type: 'string', enum: ['round', 'rect', 'tshape'] },
                  cx: { type: 'number' },
                  cy: { type: 'number' },
                  r: { type: 'number' },
                  w: { type: 'number' },
                  h: { type: 'number' },
                  stemW: { type: 'number' },
                  stemH: { type: 'number' },
                  seats: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['key'],
                      properties: {
                        key: { type: 'string' },
                        angleDeg: { type: 'number' },
                        ox: { type: 'number' },
                        oy: { type: 'number' }
                      }
                    }
                  },
                  roster: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    }
  },
  {
    name: 'liveops.clear_seat_marks',
    description: '세션의 모든 좌석 마크를 초기화(삭제)한다. 파괴적 동작 — 사용자 확인 후 호출.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.open_collaborative_excel',
    description: '협업 엑셀 템플릿 열기.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'templateId'],
      properties: {
        sessionId: { type: 'string' },
        templateId: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.update_excel_cell',
    description: '엑셀 셀 값 갱신.',
    inputSchema: {
      type: 'object',
      required: ['sessionId', 'templateId', 'cellRef', 'value'],
      properties: {
        sessionId: { type: 'string' },
        templateId: { type: 'string' },
        sheetName: { type: 'string' },
        cellRef: { type: 'string' },
        value: { type: 'string' }
      }
    }
  },
  {
    name: 'liveops.export_session_archive',
    description: '세션 아카이브 export 트리거.',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        profile: { type: 'string', enum: ['internal_retro', 'company_deliverable', 'participant_share', 'markdown_archive'] },
        formats: { type: 'array', items: { type: 'string', enum: ['md', 'xlsx', 'pdf', 'html', 'image', 'link'] } }
      }
    }
  },
  {
    name: 'liveops.preview_archive_target',
    description: 'external archive dry-run 동기화 (실제 쓰기는 scripts/external archive-apply.mjs --apply).',
    inputSchema: {
      type: 'object',
      required: ['sessionId'],
      properties: {
        sessionId: { type: 'string' },
        targetPath: { type: 'string' },
        profile: { type: 'string', enum: ['markdown_archive', 'internal_retro'] }
      }
    }
  }
]

function defaultRoleFor(action) {
  if (['liveops.answer_qna', 'liveops.upload_resource', 'liveops.export_session_archive', 'liveops.preview_archive_target'].includes(action)) return 'instructor'
  if (['liveops.update_qna_status', 'liveops.update_practice_ticket', 'liveops.append_ops_log', 'liveops.send_assistant_signal', 'liveops.acknowledge_signal', 'liveops.update_table_status', 'liveops.update_seat_mark', 'liveops.upsert_seat_layout', 'liveops.clear_seat_marks', 'liveops.attach_link'].includes(action)) return 'assistant'
  return 'participant'
}

async function callAction(name, input, meta = {}) {
  const envelope = {
    action: name,
    actor: { type: 'llm', role: meta.role ?? defaultRoleFor(name), tool: meta.tool ?? 'mcp' },
    scope: meta.scope ?? (input?.sessionId ? { sessionId: input.sessionId } : {}),
    idempotencyKey: meta.idempotencyKey ?? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    redactionPolicy: meta.redactionPolicy ?? 'summary',
    dryRun: meta.dryRun ?? false,
    input: input ?? {}
  }
  const res = await fetch(BASE + '/api/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(envelope)
  })
  const body = await res.json().catch(() => null)
  return { httpStatus: res.status, body }
}

async function main() {
  const server = new Server(
    { name: 'ax-liveops', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const meta = (args && typeof args === 'object' && args.__meta) ? args.__meta : {}
    const input = (args && typeof args === 'object') ? { ...args, __meta: undefined } : {}
    delete input.__meta
    const out = await callAction(name, input, meta)
    return {
      content: [
        { type: 'text', text: JSON.stringify(out.body ?? { httpStatus: out.httpStatus }, null, 2) }
      ],
      isError: out.httpStatus >= 400
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write('[ax-liveops] MCP server ready (stdio) base=' + BASE + '\n')
}

main().catch((e) => {
  process.stderr.write('[ax-liveops] fatal: ' + (e?.message ?? e) + '\n')
  process.exit(1)
})
