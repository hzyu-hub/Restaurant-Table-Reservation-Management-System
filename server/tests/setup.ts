/**
 * Shared test harness: one in-memory MongoDB per test file, cleaned between
 * tests. Nothing is mocked - these tests exercise the real Mongoose models and
 * the real unique `{tableId, slotStart}` index.
 *
 * Index creation goes through the same `ensureSlotIndexes()` helper the API
 * uses at boot (`src/lib/slots.ts`), because `autoIndex` is off. Using one code
 * path means the tests assert against the index the production process actually
 * builds, and the index assertion is exercised on every test run.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { ensureSlotIndexes } from '../src/lib/slots.js';
import { RATE_LIMIT_DISABLED_ENV } from '../src/lib/rate-limit.js';

let memoryServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  // The booking suite issues far more than 10 POSTs from 127.0.0.1 in total.
  // Leaving the limiter on would make results depend on test ordering; the
  // rate-limit test builds its own app with an explicit limiter instead.
  process.env[RATE_LIMIT_DISABLED_ENV] = '1';

  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('restaurant_test'), {
    serverSelectionTimeoutMS: 10_000,
    // Match production: indexes are created explicitly, not automatically.
    autoIndex: false,
  });

  // Make sure the guard index really exists before any write races happen.
  await ensureSlotIndexes();
});

afterEach(async () => {
  const collections = await mongoose.connection.db?.collections();
  for (const collection of collections ?? []) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.connection.close();
  await memoryServer?.stop();
});
