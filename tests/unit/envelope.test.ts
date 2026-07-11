import { describe, it, expect } from 'vitest';
import { AxActionEnvelopeSchema, RedactionPolicyEnum, AxActorSchema } from '@/lib/action/envelope';

describe('envelope schema', () => {
  it('valid envelope parse OK + defaults 주입', () => {
    const r = AxActionEnvelopeSchema.parse({
      action: 'liveops.add_qna',
      actor: { type: 'human', role: 'admin' },
      idempotencyKey: 'k-1',
      input: { body: 'hi' }
    });
    expect(r.action).toBe('liveops.add_qna');
    expect(r.redactionPolicy).toBe('summary'); // default
    expect(r.dryRun).toBe(false);
    expect(r.actor.tool).toBe('web-ui'); // default
    expect(r.scope).toEqual({});
  });

  it('action 누락 → throw', () => {
    expect(() =>
      AxActionEnvelopeSchema.parse({
        actor: { type: 'human', role: 'admin' },
        idempotencyKey: 'k'
      })
    ).toThrow();
  });

  it('invalid role → throw', () => {
    expect(() =>
      AxActionEnvelopeSchema.parse({
        action: 'liveops.add_qna',
        actor: { type: 'human', role: 'guest' },
        idempotencyKey: 'k'
      })
    ).toThrow();
  });

  it('redactionPolicy enum 4종 모두 통과', () => {
    for (const p of ['none', 'summary', 'mask-private', 'metadata-only']) {
      expect(RedactionPolicyEnum.parse(p)).toBe(p);
    }
  });

  it('AxActorSchema tool 미지정 시 web-ui default', () => {
    const r = AxActorSchema.parse({ type: 'llm', role: 'instructor' });
    expect(r.tool).toBe('web-ui');
  });
});
