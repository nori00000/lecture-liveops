/**
 * Lecture LiveOps — structured logger (P1-6)
 * - 한 줄 JSON, stdout (Vercel은 stdout/stderr를 Drain으로 수집)
 * - requestId / level / msg / meta
 * - secrets 패턴 자동 redact (Bearer/sk-/eyJ/postgres://…/AX_SESSION_SECRET)
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SECRET_PATTERNS: { re: RegExp; placeholder: string }[] = [
  { re: /Bearer\s+[A-Za-z0-9._-]+/gi, placeholder: 'Bearer [REDACTED]' },
  { re: /sk-[A-Za-z0-9_-]{20,}/g, placeholder: 'sk-[REDACTED]' },
  { re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, placeholder: '[REDACTED_JWT]' },
  { re: /postgres(?:ql)?:\/\/[^\s"']+/gi, placeholder: 'postgres://[REDACTED]' },
  { re: /gho_[A-Za-z0-9]{20,}/g, placeholder: 'gho_[REDACTED]' },
  { re: /glpat-[A-Za-z0-9_-]{15,}/g, placeholder: 'glpat-[REDACTED]' },
  { re: /xoxb-[A-Za-z0-9-]{20,}/g, placeholder: 'xoxb-[REDACTED]' },
  { re: /\b[A-Fa-f0-9]{64}\b/g, placeholder: '[REDACTED_HEX64]' }
];

export function redact(value: unknown): unknown {
  if (typeof value === 'string') {
    let v = value;
    for (const { re, placeholder } of SECRET_PATTERNS) v = v.replace(re, placeholder);
    return v;
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(password|secret|token|api[_-]?key|cookie|authorization|jwt)/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? { meta: redact(meta) } : {})
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta)
};

export type RequestContext = {
  requestId: string;
  path: string;
  method: string;
  startMs: number;
};

export function newRequestContext(req: Request, requestId: string): RequestContext {
  return {
    requestId,
    path: new URL(req.url).pathname,
    method: req.method,
    startMs: Date.now()
  };
}

export function logRequest(ctx: RequestContext, status: number, extra?: Record<string, unknown>): void {
  log.info('http', {
    request_id: ctx.requestId,
    method: ctx.method,
    path: ctx.path,
    status,
    duration_ms: Date.now() - ctx.startMs,
    ...(extra ?? {})
  });
}
