import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emailAdapter, smsAdapter, resetEmailAdapterForTest } from '@/lib/notify'
import { notify } from '@/lib/notify'
import type { NotifyResult } from '@/lib/notify'

const ORIG_ENV = { ...process.env }

function clearEnv() {
  delete process.env.RESEND_API_KEY
  delete process.env.AUTH_RESEND_KEY
  delete process.env.TWILIO_ACCOUNT_SID
  delete process.env.TWILIO_AUTH_TOKEN
  delete process.env.TWILIO_FROM
  resetEmailAdapterForTest()
}

beforeEach(() => clearEnv())
afterEach(() => {
  process.env = { ...ORIG_ENV }
  resetEmailAdapterForTest()
})

describe('notify adapters — dev fallback (key 없을 때)', () => {
  it('emailAdapter: key 없으면 fallback ok=true + fallback=true (console)', async () => {
    expect(emailAdapter.enabled()).toBe(false)
    const r = await emailAdapter.send({ channel: 'email', to: 'x@y.com', subject: 's', body: 'hi' })
    expect(r.ok).toBe(true)
    expect(r.provider).toBe('resend')
    expect(r.fallback).toBe(true)
  })


  it('smsAdapter: key 없으면 fallback', async () => {
    expect(smsAdapter.enabled()).toBe(false)
    const r = await smsAdapter.send({ channel: 'sms', to: '+82-10-0000-0000', body: 'hi' })
    expect(r.ok).toBe(true)
    expect(r.fallback).toBe(true)
  })
})

describe('notify dispatcher', () => {
  it('이메일만 전달 → 1 result (email fallback)', async () => {
    const results = await notify({ event: 'qna_answered', to: { email: 'a@b.com' }, body: 'hi' })
    expect(results.length).toBe(1)
    expect(results[0].provider).toBe('resend')
  })

  it('이메일 + phone → 2 result (email + sms)', async () => {
    const results = await notify({ event: 'signal_raised', to: { email: 'a@b.com', phone: '+821000000000' }, body: 'hi' })
    expect(results.length).toBe(2)
    const providers = results.map((r) => r.provider).sort()
    expect(providers).toEqual(['resend', 'twilio-sms'])
  })

  it('phone만, sms도 미설정 → 1 fallback', async () => {
    const results = await notify({ event: 'signal_raised', to: { phone: '+821000000000' }, body: 'hi' })
    expect(results.length).toBe(1)
    expect(results[0].provider).toBe('twilio-sms')
    expect(results[0].fallback).toBe(true)
  })

  it('recipient 없으면 빈 배열', async () => {
    const results = await notify({ event: 'qna_answered', to: {}, body: 'hi' })
    expect(results).toEqual([])
  })


  it('dispatcher: 1 채널 reject 발생해도 다른 채널 진행 (allSettled)', async () => {
    // emailAdapter.send를 spy로 reject 시키기
    const spy = vi.spyOn(emailAdapter, 'send').mockRejectedValueOnce(new Error('boom') as unknown as Awaited<NotifyResult>)
    const results = await notify({ event: 'qna_answered', to: { email: 'a@b.com', phone: '+821000000000' }, body: 'hi' })
    expect(results.length).toBe(2) // email reject + sms fallback
    const reject = results.find((r) => r.provider === 'dispatcher')
    expect(reject?.ok).toBe(false)
    spy.mockRestore()
  })
})
