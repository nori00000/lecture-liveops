/**
 * getToday() 상황판 세션 선택 회귀 테스트 (fixture mode).
 * 재발 방지: "만든(예정) 세션이 상황판에 안 보인다" + "과거 live 세션이 상황판을 오염한다".
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});

import { sessions } from '@/lib/db/repo/sessions';
import { getStore, resetStore } from '@/lib/db/fixture/store';
import { adminContext } from '@/lib/db/neonHelpers';
import { todayKo } from '@/lib/util/koreanTime';
import type { Session } from '@/lib/db/schema';

const today = todayKo();
function shift(days: number): string {
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function mk(over: Partial<Session> & { id: string; date: string }): Session {
  return {
    id: over.id,
    company_id: 'co-x',
    course_id: 'cr-x',
    date: over.date,
    title: over.title ?? over.id,
    venue: '',
    mode: over.mode ?? 'prep',
    private_by_default: true,
    metadata: {},
    created_at: over.created_at ?? new Date().toISOString()
  };
}
const future = shift(3);
const far = shift(10);
const past = shift(-3);
const older = shift(-10);

describe('sessions.getToday — 상황판 세션 선택', () => {
  beforeEach(() => {
    resetStore();
    getStore().sessions = [];
  });

  it('오늘 세션이 최우선', async () => {
    getStore().sessions = [mk({ id: 'p', date: past, mode: 'live' }), mk({ id: 'today', date: today, mode: 'prep' }), mk({ id: 'f', date: future })];
    expect((await sessions.getToday(adminContext()))?.id).toBe('today');
  });

  it('오늘 없으면 가장 가까운 예정 세션이 뜬다 (만든 세션이 안 보이는 문제 방지)', async () => {
    getStore().sessions = [mk({ id: 'far', date: far }), mk({ id: 'near', date: future })];
    expect((await sessions.getToday(adminContext()))?.id).toBe('near');
  });

  it('예정 세션이 과거 live 보다 우선 (과거 live 상황판 오염 방지)', async () => {
    getStore().sessions = [mk({ id: 'stale', date: past, mode: 'live' }), mk({ id: 'upcoming', date: future, mode: 'prep' })];
    expect((await sessions.getToday(adminContext()))?.id).toBe('upcoming');
  });

  it('오늘·예정 없으면 최근 과거 세션(live 우선)', async () => {
    getStore().sessions = [mk({ id: 'older-after', date: older, mode: 'after' }), mk({ id: 'recent-live', date: past, mode: 'live' })];
    expect((await sessions.getToday(adminContext()))?.id).toBe('recent-live');
  });

  it('archived 는 상황판 후보에서 제외', async () => {
    getStore().sessions = [mk({ id: 'arch', date: today, mode: 'archived' }), mk({ id: 'up', date: future, mode: 'prep' })];
    expect((await sessions.getToday(adminContext()))?.id).toBe('up');
  });
});
