import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // mongodb-memory-server spins up one mongod per test file; keep files
    // sequential so a single binary download / port allocation happens at a time.
    fileParallelism: false,
    pool: 'forks',
    /**
     * The rate limiter counts per process and per IP, and the whole suite runs
     * from `127.0.0.1`, so an always-on limiter would make results depend on
     * test ordering. It is disabled here rather than in `tests/setup.ts`
     * because `createApp()` is called at module load, before any `beforeAll`
     * hook runs. `tests/rate-limit.test.ts` passes an explicit `rateLimit`
     * option, which overrides this switch, so the middleware is still covered.
     */
    env: { DISABLE_RATE_LIMIT: '1' },
    testTimeout: 30_000,
    hookTimeout: 180_000,
    teardownTimeout: 30_000,
  },
});
