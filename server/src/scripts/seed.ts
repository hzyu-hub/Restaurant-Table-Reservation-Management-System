/**
 * Seed script: 6 tables (2/2/4/4/6/8) plus one staff account.
 * Idempotent — running it twice leaves the same 6 tables and 1 staff user.
 *
 * Usage:
 *   MONGODB_URI="mongodb+srv://..." npm run seed
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectToDatabase, disconnectFromDatabase } from '../db.js';
import { StaffUser } from '../models/StaffUser.js';
import { Table } from '../models/Table.js';

const SEED_TABLES: readonly { label: string; capacity: number }[] = [
  { label: 'T1', capacity: 2 },
  { label: 'T2', capacity: 2 },
  { label: 'T3', capacity: 4 },
  { label: 'T4', capacity: 4 },
  { label: 'T5', capacity: 6 },
  { label: 'T6', capacity: 8 },
];

const SEED_STAFF_USERNAME = 'staff';
const BCRYPT_ROUNDS = 10;

/** Length of the generated password, in bytes of entropy before base64. */
const GENERATED_PASSWORD_BYTES = 18;

/**
 * Resolves the staff password.
 *
 * There is no password literal in this file: a committed credential ships with
 * every deployment and cannot be rotated without a code change. Precedence:
 *
 * 1. `SEED_STAFF_PASSWORD` from the environment, when set.
 * 2. Otherwise a random password, printed ONCE with a warning.
 *
 * Returns the password plus whether it was generated, so the caller knows
 * whether it is safe to echo it.
 */
function resolveStaffPassword(): { password: string; generated: boolean } {
  const fromEnv = process.env.SEED_STAFF_PASSWORD?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return { password: fromEnv, generated: false };
  }

  // base64url keeps it copy-pasteable without shell quoting surprises.
  const password = randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');
  return { password, generated: true };
}

async function seed(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (uri === undefined || uri.length === 0) {
    console.error(
      '[seed] MONGODB_URI is not set, so there is nothing to seed against.\n' +
        '[seed] Set it to your MongoDB Atlas connection string, e.g.\n' +
        '       MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/<db>" npm run seed\n' +
        '[seed] (Tests do not need this — they use mongodb-memory-server.)',
    );
    process.exitCode = 1;
    return;
  }

  await connectToDatabase(uri);
  console.log('[seed] connected to MongoDB');

  // `upsert` keeps this idempotent without deleting reservation history.
  for (const table of SEED_TABLES) {
    await Table.updateOne(
      { label: table.label },
      { $set: { capacity: table.capacity, active: true }, $setOnInsert: { label: table.label } },
      { upsert: true },
    );
  }
  const tableCount = await Table.countDocuments();
  console.log(`[seed] tables ready: ${SEED_TABLES.length} upserted, ${tableCount} total`);

  const { password, generated } = resolveStaffPassword();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await StaffUser.updateOne(
    { username: SEED_STAFF_USERNAME },
    {
      $set: { passwordHash, role: 'staff' },
      $setOnInsert: { username: SEED_STAFF_USERNAME },
    },
    { upsert: true },
  );
  const staffCount = await StaffUser.countDocuments();
  console.log(
    `[seed] staff user "${SEED_STAFF_USERNAME}" ready (${staffCount} total)`,
  );

  if (generated) {
    console.log('');
    console.log('[seed] SEED_STAFF_PASSWORD was not set, so a random one was generated.');
    console.log('[seed] Copy it now: THIS IS THE ONLY TIME IT WILL BE SHOWN.');
    console.log(`[seed]   username: ${SEED_STAFF_USERNAME}`);
    console.log(`[seed]   password: ${password}`);
    console.log(
      '[seed] Re-running the seed replaces the stored hash. Set SEED_STAFF_PASSWORD ' +
        'to keep a known value.',
    );
    console.log('');
  }
}

seed()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectFromDatabase();
  });
