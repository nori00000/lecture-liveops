// vitest setup: handler unit tests 는 fixture mode 강제.
// integration test (tests/integration/) 는 별도 env 명시 필요.
import { beforeAll } from 'vitest';

beforeAll(() => {
  // process.env 에서 DATABASE_URL 제거 → client.ts 가 fixture mode 선택
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_URL_ANON;
  process.env.AX_MODE = 'fixture';
});
