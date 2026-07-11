/**
 * P1-7 라이브 검증 — neon transaction atomic rollback.
 * 실제 Neon DB 사용. DATABASE_URL_ANON 미설정 시 skip.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withTxn, query, queryOwner, type RlsContext } from '@/lib/db/neonHelpers';
import { newId } from '@/lib/util/id';

const HAS_NEON = Boolean(process.env.DATABASE_URL_ANON?.startsWith('postgres'));
const d = HAS_NEON ? describe : describe.skip;

const ADMIN: RlsContext = { role: 'admin' };

d('withTxn — neon atomic rollback', () => {
  // 테스트용 임시 테이블 (마이그레이션 불필요, 본 테스트 안에서만 사용)
  const TABLE = `ax_p1_7_tx_test_${Date.now()}`;

  beforeAll(async () => {
    // owner role 로 임시 테이블 생성 + liveops_anon 에 권한 부여
    await queryOwner(`create table if not exists ${TABLE} (id text primary key, val text not null)`);
    await queryOwner(`grant select, insert, update, delete on ${TABLE} to liveops_anon`);
  });

  afterAll(async () => {
    await queryOwner(`drop table if exists ${TABLE}`);
  });

  it('두 INSERT 모두 성공하면 commit', async () => {
    const a = newId('a');
    const b = newId('b');
    await withTxn(ADMIN, (sql) => [
      sql`insert into ${sql.unsafe(TABLE)} (id, val) values (${a}, 'ok-a') returning id`,
      sql`insert into ${sql.unsafe(TABLE)} (id, val) values (${b}, 'ok-b') returning id`
    ]);
    const rows = await query<{ id: string; val: string }>(ADMIN, `select * from ${TABLE} where id in ($1, $2) order by val`, [a, b]);
    expect(rows.map((r) => r.val)).toEqual(['ok-a', 'ok-b']);
  });

  it('두 번째 INSERT가 PK conflict로 fail → 첫 번째도 rollback', async () => {
    const dup = newId('dup');
    // 미리 dup id 1건 삽입
    await query(ADMIN, `insert into ${TABLE} (id, val) values ($1, $2)`, [dup, 'pre-existing']);
    const survivor = newId('surv');

    await expect(
      withTxn(ADMIN, (sql) => [
        sql`insert into ${sql.unsafe(TABLE)} (id, val) values (${survivor}, 'should-rollback')`,
        sql`insert into ${sql.unsafe(TABLE)} (id, val) values (${dup}, 'will-fail')`
      ])
    ).rejects.toThrow();

    // survivor 행이 존재하지 않아야 (rollback 됨)
    const rows = await query<{ id: string }>(ADMIN, `select id from ${TABLE} where id = $1`, [survivor]);
    expect(rows.length).toBe(0);

    // 기존 dup 행은 그대로
    const dupRows = await query<{ val: string }>(ADMIN, `select val from ${TABLE} where id = $1`, [dup]);
    expect(dupRows[0]?.val).toBe('pre-existing');
  });

  it('set_config 가 transaction scope 안에서 적용됨', async () => {
    const r = await withTxn<[{ a: string }[], { b: string }[]]>(
      { role: 'participant', sessionId: 'se-test-123' },
      (sql) => [
        sql`select current_setting('request.jwt.claims', true) as a`,
        sql`select current_setting('request.headers', true) as b`
      ]
    );
    expect(r[0][0].a).toContain('participant');
    expect(r[1][0].b).toContain('se-test-123');
  });

  it('empty statements 는 즉시 에러', async () => {
    await expect(withTxn(ADMIN, () => [])).rejects.toThrow('empty statements');
  });
});
