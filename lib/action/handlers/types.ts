import type { AxActionEnvelope } from '../envelope'

export type HandlerContext = {
  envelope: AxActionEnvelope
}

export type Handler = (ctx: HandlerContext) => Promise<{ data?: unknown; summary?: string }>
