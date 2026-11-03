/**
 * Shared test harness: one in-memory MongoDB per test file, cleaned between
 * tests. Nothing is mocked — these tests exercise the real Mongoose models and
 * the real unique `{tableId, slotStart}` index.
 */
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll } from 'vitest';

let memoryServer: MongoMemoryServer | undefined;

beforeAll(async () => {
  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri('restaurant_test'), {
    serverSelectionTimeoutMS: 10_000,
  });

  // Make sure the guard index really exists before any write races happen.
  await mongoose.connection.db
    ?.collection('tableSlots')
    .createIndex({ tableId: 1, slotStart: 1 }, { unique: true });
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
