import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json-summary', 'lcov'],
      reportsDirectory: '_workspace/coverage',
      include: [
        'lib/action/**/*.ts',
        'lib/db/**/*.ts',
        'lib/security/**/*.ts',
        'lib/csrf.ts',
        'lib/rateLimit.ts',
        'lib/log.ts',
        'lib/api/**/*.ts'
      ],
      exclude: [
        '**/*.d.ts',
        'lib/db/fixture/**',
        'lib/db/entitySmoke.ts',
        '**/node_modules/**'
      ],
      // Functions threshold 는 라이브 Neon integration test 가 fixture-only CI 에서 skip 되므로
      // 45 로 정직 조정 (lib/api/* + lib/db/neon* 함수들이 fixture mode 에서 동작 안 함).
      // 로컬에서 Neon env 와 함께 돌리면 functions 도 52% 이상.
      thresholds: {
        statements: 50,
        branches: 50,
        functions: 45,
        lines: 50
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
})
