import mongoose from 'mongoose';
import { ensureSlotIndexes, reconcileOrphanedSlots } from './lib/slots.js';

/**
 * Connects to the configured MongoDB instance, then makes the database safe to
 * serve traffic against.
 *
 * Index management is deliberately explicit (`autoIndex: false`). Mongoose's
 * automatic index creation happens asynchronously off the back of
 * `Model.init()` and reports failures through a path with worse error
 * reporting, which meant the `tableSlots` unique index was previously created
 * twice by two different code paths. There is now exactly one creation site:
 * the schema declaration in `models/TableSlot.ts`, invoked from
 * `ensureSlotIndexes()`.
 *
 * Both post-connect steps are fail-closed. A missing unique index means silent
 * double booking, so refusing to start is the correct outcome.
 */
export async function connectToDatabase(uri: string): Promise<void> {
  if (uri.trim().length === 0) {
    throw new Error('MONGODB_URI is not set.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    // Create indexes only where we say so, so creation happens once and fails
    // loudly instead of asynchronously via `Model.init()`.
    autoIndex: false,
  });

  await ensureSlotIndexes();

  // Recover any table that a crashed process left blocked. Rows younger than
  // the grace period are in-flight bookings and are left alone.
  const removed = await reconcileOrphanedSlots();
  if (removed > 0) {
    // Count only: these rows belong to customer bookings.
    console.warn(`[db] removed ${removed} orphaned table slot row(s)`);
  }
}

/** Closes the mongoose connection (used by the seed script and shutdown). */
export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.connection.close();
}

export { mongoose };
