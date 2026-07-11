/**
 * Lecture LiveOps — API route handler wrapper (P1-6)
 * - request id 생성 (X-Request-Id 헤더에 우선, 없으면 uuidv4)
 * - try/catch + Sentry.captureException + structured log
 * - 응답 헤더에 X-Request-Id 자동 주입
 */

import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import * as Sentry from '@sentry/nextjs';
import { log, logRequest, newRequestContext, type RequestContext } from '../log';

export type ApiHandler = (req: Request, ctx: RequestContext) => Promise<Response>;

export function withApi(handler: ApiHandler): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const requestId = req.headers.get('x-request-id') ?? uuidv4();
    const ctx = newRequestContext(req, requestId);
    try {
      const res = await handler(req, ctx);
      const out = new Response(res.body, res);
      out.headers.set('x-request-id', requestId);
      logRequest(ctx, out.status);
      return out;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      const stack = err instanceof Error ? err.stack : undefined;
      Sentry.captureException(err, { tags: { route: ctx.path, request_id: requestId } });
      log.error('http_error', {
        request_id: requestId,
        method: ctx.method,
        path: ctx.path,
        error: message,
        stack: stack?.split('\n').slice(0, 5).join('\n')
      });
      const payload = { error: 'internal_error', request_id: requestId };
      return NextResponse.json(payload, {
        status: 500,
        headers: { 'x-request-id': requestId, 'cache-control': 'no-store' }
      });
    }
  };
}
