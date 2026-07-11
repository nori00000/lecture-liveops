import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { log, redact, newRequestContext, logRequest } from '@/lib/log';

describe('log.redact', () => {
  it('strings에서 Bearer 토큰 마스킹', () => {
    const out = redact('header: Bearer abc.def.ghi-token_value-123456');
    expect(out).toBe('header: Bearer [REDACTED]');
  });

  it('postgres connection string 전체 마스킹', () => {
    const out = redact('connect to postgres:' + '//user:pass@host/db?sslmode=require ok');
    expect(out).toBe('connect to postgres:' + '//[REDACTED] ok');
  });

  it('JWT 토큰 마스킹', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.signature_part_here';
    const out = redact(`token = ${jwt} bye`);
    expect(out).toBe('token = [REDACTED_JWT] bye');
  });

  it('객체 key가 password/secret/token이면 값 [REDACTED]', () => {
    const out = redact({ user: 'alice', password: 'p4ss', api_key: 'sk-xxx', nested: { authorization: 'Bearer x' } });
    expect(out).toEqual({
      user: 'alice',
      password: '[REDACTED]',
      api_key: '[REDACTED]',
      nested: { authorization: '[REDACTED]' }
    });
  });

  it('배열 순회 redact', () => {
    const out = redact(['Bearer abcdefghij1234567890', 'plain']);
    expect(out).toEqual(['Bearer [REDACTED]', 'plain']);
  });
});

describe('log emit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('JSON 한 줄 + ts/level/msg/meta', () => {
    log.info('hello', { request_id: 'r1' });
    expect(console.log).toHaveBeenCalledOnce();
    const line = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('hello');
    expect(parsed.meta).toEqual({ request_id: 'r1' });
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('error는 stderr로', () => {
    log.error('boom', { err: 'fail' });
    expect(console.error).toHaveBeenCalledOnce();
  });

  it('meta에 secret 패턴 자동 마스킹', () => {
    log.info('req', { cookie: 'ax_session=eyJabc.def.ghi-real-token-1234567890' });
    const line = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.meta.cookie).toBe('[REDACTED]');
  });
});

describe('logRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('duration_ms + status + path + method 기록', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const req = new Request('https://example.test/api/health', { method: 'GET' });
    const ctx = newRequestContext(req, 'req-1');
    logRequest(ctx, 200, { extra: 1 });
    const line = (console.log as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    const parsed = JSON.parse(line);
    expect(parsed.meta.method).toBe('GET');
    expect(parsed.meta.path).toBe('/api/health');
    expect(parsed.meta.status).toBe(200);
    expect(typeof parsed.meta.duration_ms).toBe('number');
    expect(parsed.meta.extra).toBe(1);
  });
});
