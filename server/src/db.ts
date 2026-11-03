import mongoose from 'mongoose';

/** Connects to the configured MongoDB instance. Throws when no URI is set. */
export async function connectToDatabase(uri: string): Promise<void> {
  if (uri.trim().length === 0) {
    throw new Error('MONGODB_URI is not set.');
  }

  mongoose.set('strictQuery', true);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

  // `tableSlots` relies on its unique index for correctness, so make sure the
  // indexes exist before the API starts accepting writes.
  await mongoose.connection.db?.collection('tableSlots').createIndex(
    { tableId: 1, slotStart: 1 },
    { unique: true },
  );
}

/** Closes the mongoose connection (used by the seed script and shutdown). */
export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.connection.close();
}

export { mongoose };
