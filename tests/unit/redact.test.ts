import { describe, it, expect } from 'vitest';
import { redactInput, hashInput } from '@/lib/action/redact';

describe('redact policies', () => {
  const INPUT = { body: '실제 질문 본문', email: 'a@b.com', meta: { x: 1 } };

  it('none → 본문 평탄 join (단 200자 잘림)', () => {
    const r = redactInput(INPUT, 'none');
    expect(r).toContain('실제 질문 본문');
    expect(r.length).toBeLessThanOrEqual(200);
  });

  it('summary → 첫 문자열 일부만 + 160자 cap', () => {
    const longBody = '가'.repeat(500);
    const r = redactInput({ body: longBody }, 'summary');
    expect(r.length).toBeLessThanOrEqual(160);
  });

  it('mask-private → 이메일/전화번호 패턴 마스킹', () => {
    const r = redactInput({ body: 'contact a@b.com or 010-1234-5678' }, 'mask-private');
    expect(r).not.toContain('a@b.com');
    expect(r).not.toContain('010-1234-5678');
  });

  it('metadata-only → 본문 없이 키 목록만', () => {
    const r = redactInput(INPUT, 'metadata-only');
    expect(r).toContain('[metadata-only]');
    expect(r).toContain('body');
    expect(r).toContain('email');
    expect(r).not.toContain('실제 질문 본문');
  });
});

describe('hashInput', () => {
  it('동일 input → 동일 24-char hash', () => {
    const a = hashInput({ x: 1 });
    const b = hashInput({ x: 1 });
    expect(a).toBe(b);
    expect(a.length).toBe(24);
  });

  it('다른 input → 다른 hash', () => {
    expect(hashInput({ x: 1 })).not.toBe(hashInput({ x: 2 }));
  });
});
