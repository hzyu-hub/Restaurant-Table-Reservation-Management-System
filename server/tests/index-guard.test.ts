/**
 * The startup index assertion (audit 4.3, 4.4, rec 1).
 *
 * Verified failure this locks down: with the unique index dropped, five of five
 * concurrent bookings succeed and the API writes five reservations for one
 * table at one time. Nothing throws, nothing is logged. The index is the only
 * thing preventing that, so its absence must be a loud startup failure rather
 * than an unstated environmental assumption.
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  assertSlotUniqueIndex,
  ensureSlotIndexes,
} from '../src/lib/slots.js';
import { TableSlot } from '../src/models/TableSlot.js';

const UNIQUE_INDEX_NAME = 'tableId_1_slotStart_1';

/** Restores the schema-declared indexes after a test disturbs them. */
async function restoreIndexes(): Promise<void> {
  await TableSlot.collection.dropIndexes().catch(() => undefined);
  await ensureSlotIndexes();
}

describe('slot index guard', () => {
  beforeEach(async () => {
    await restoreIndexes();
  });

  afterEach(async () => {
    await restoreIndexes();
  });

  it('passes when the unique index is present', async () => {
    await expect(assertSlotUniqueIndex()).resolves.toBeUndefined();
  });

  it('throws, naming double booking, when the unique index is missing', async () => {
    await TableSlot.collection.dropIndex(UNIQUE_INDEX_NAME);

    await expect(assertSlotUniqueIndex()).rejects.toThrow(/double book/i);
    await expect(assertSlotUniqueIndex()).rejects.toThrow(/tableId: 1, slotStart: 1/);
    await expect(assertSlotUniqueIndex()).rejects.toThrow(/index-creation rights/i);
  });

  it('throws when an index on the key exists but is NOT unique', async () => {
    await TableSlot.collection.dropIndex(UNIQUE_INDEX_NAME);
    await TableSlot.collection.createIndex({ tableId: 1, slotStart: 1 });

    // This is the dangerous state: the index exists, so a naive "does the
    // index exist" check would pass while the guard is gone.
    await expect(assertSlotUniqueIndex()).rejects.toThrow(/NOT unique/);
  });

  it('rethrows a name collision (Mongo code 86) as a uniqueness message', async () => {
    // A pre-existing NON-unique index with the same auto-generated name makes
    // createIndex fail with code 86, whose own text never mentions uniqueness.
    await TableSlot.collection.dropIndex(UNIQUE_INDEX_NAME);
    await TableSlot.collection.createIndex({ tableId: 1, slotStart: 1 });

    await expect(ensureSlotIndexes()).rejects.toThrow(/unique: true/);
    await expect(ensureSlotIndexes()).rejects.toThrow(/double booking/);
  });

  it('creates the index from the schema when the collection has none', async () => {
    await TableSlot.collection.dropIndexes();

    await ensureSlotIndexes();

    const indexes = await TableSlot.collection.indexes();
    const unique = indexes.find(
      (index) =>
        index.name === UNIQUE_INDEX_NAME && index.unique === true,
    );
    expect(unique).toBeDefined();
  });
});
