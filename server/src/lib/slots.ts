/**
 * The single owner of the `tableSlots` collection.
 *
 * INVARIANT (audit 4.1, rec 3): this is the ONLY module under `server/src` that
 * may import the `TableSlot` model. Every read and every write of slot rows
 * goes through the functions exported here, so "a slot row exists if and only
 * if the owning reservation is in a blocking status" has one place to live and
 * one place to break.
 *
 * `tests/architecture.test.ts` enforces that rule mechanically: it reads the
 * source tree and fails if any other file under `server/src` imports the model.
 *
 * Three responsibilities, deliberately co-located because they all depend on
 * the same invariant:
 *
 *   1. Index management and the startup assertion (`ensureSlotIndexes`). The
 *      unique `{tableId, slotStart}` index is the ONLY thing preventing double
 *      booking (FR4). Nothing else verifies that it still exists, so a missing
 *      index is asserted against at every boot rather than assumed.
 *   2. Mutation (`reserveWindow`, `releaseWindow`).
 *   3. Repair (`reconcileOrphanedSlots`) for rows written by a process that
 *      died before it could write the reservation.
 */
import mongoose from 'mongoose';
import { SLOTS_PER_BOOKING } from '../config/booking.js';
import { Reservation } from '../models/Reservation.js';
import { TableSlot } from '../models/TableSlot.js';

/**
 * The model itself stays private to this module. Other modules may need the
 * document *type*; they never need the model.
 */
export type { TableSlotAttributes, TableSlotDocument } from '../models/TableSlot.js';

/**
 * The compound key the concurrency guard depends on.
 *
 * Declared once and compared field-by-field against the live index list, so the
 * assertion and the schema declaration cannot drift.
 */
export const SLOT_UNIQUE_INDEX_KEY = { tableId: 1, slotStart: 1 } as const;

/** MongoDB error code for "an existing index has the same name but different options". */
const INDEX_KEY_SPECS_CONFLICT = 86;

/**
 * How long a slot row may exist without a matching reservation before the
 * reconciler treats it as an orphan.
 *
 * THIS GRACE PERIOD IS LOAD-BEARING, NOT A TUNING KNOB. `reserveWindow` writes
 * slot rows BEFORE the reservation document exists (see `services/booking.ts`),
 * so at any instant a perfectly healthy in-flight booking looks exactly like an
 * orphan. A reconciler without this window would delete rows out from under
 * concurrent bookings and re-open the double-booking race it exists to repair.
 * 60 seconds is far longer than the two awaits it has to cover and far shorter
 * than a human would notice a blocked table.
 */
export const ORPHAN_GRACE_PERIOD_MS = 60_000;

/** A slot row as the availability query needs it: which table, which instant. */
export interface OccupiedSlot {
  tableId: string;
  slotStart: Date;
}

/** The window one booking wants to own. */
export interface ReserveWindowRequest {
  tableId: mongoose.Types.ObjectId;
  reservationId: mongoose.Types.ObjectId;
  /** Exactly `SLOTS_PER_BOOKING` instants, in ascending order. */
  slotStarts: readonly Date[];
}

/**
 * Outcome of an attempt to take a window.
 *
 * `SLOT_TAKEN` means another request already holds at least one of the rows:
 * an expected, recoverable outcome that the caller handles by trying the next
 * candidate table. Any other failure is rethrown, because it is not something
 * the caller can route around.
 */
export type ReserveWindowResult =
  | { reserved: true }
  | { reserved: false; reason: 'SLOT_TAKEN' };

/** Tells a unique-index violation apart from any other write failure. */
function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; writeErrors?: unknown };

  if (candidate.code === 11000) {
    return true;
  }

  if (Array.isArray(candidate.writeErrors)) {
    return candidate.writeErrors.some((writeError: unknown) => {
      if (typeof writeError !== 'object' || writeError === null) {
        return false;
      }
      const { code } = writeError as { code?: unknown };
      return code === 11000;
    });
  }

  return false;
}

/** Reads a numeric Mongo error code off an unknown thrown value, if present. */
function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const { code } = error as { code?: unknown };
  return typeof code === 'number' ? code : undefined;
}

/** True when an index key document is exactly `{tableId: 1, slotStart: 1}`. */
function isSlotUniqueIndexKey(key: Record<string, unknown> | undefined): boolean {
  if (key === undefined) {
    return false;
  }
  const expectedFields = Object.keys(SLOT_UNIQUE_INDEX_KEY);
  if (Object.keys(key).length !== expectedFields.length) {
    return false;
  }
  return expectedFields.every(
    (field) =>
      key[field] ===
      SLOT_UNIQUE_INDEX_KEY[field as keyof typeof SLOT_UNIQUE_INDEX_KEY],
  );
}

/**
 * Verifies that the collection really has a UNIQUE `{tableId, slotStart}` index.
 *
 * This is an assertion about the live database, not about the schema: the
 * schema can say `unique: true` while the collection holds a non-unique index of
 * the same name (a hand-created index, or one left by an older schema version).
 * In that state every concurrency test still passes locally and the API
 * double-books in production, silently. Refusing to boot is the correct
 * response, so this throws instead of warning.
 */
export async function assertSlotUniqueIndex(): Promise<void> {
  const indexes = await TableSlot.collection.indexes();
  const match = indexes.find((index) =>
    isSlotUniqueIndexKey(index.key as Record<string, unknown> | undefined),
  );

  if (match === undefined) {
    throw new Error(
      'STARTUP ABORTED: the `tableSlots` collection has no index on ' +
        '{tableId: 1, slotStart: 1}. That index is the ONLY mechanism preventing ' +
        'two customers from booking the same table at the same time, so serving ' +
        'traffic without it means silent double booking. Check that the MongoDB ' +
        'user has index-creation rights (createIndex) on this database, then ' +
        'restart. Do not "fix" this by disabling the check.',
    );
  }

  if (match.unique !== true) {
    throw new Error(
      'STARTUP ABORTED: the `tableSlots` index on {tableId: 1, slotStart: 1} ' +
        'exists but is NOT unique. Without the uniqueness constraint concurrent ' +
        'bookings for the same table and time all succeed, which is silent ' +
        'double booking. Drop the index and let startup recreate it, or check ' +
        'that the MongoDB user has index-creation rights on this database.',
    );
  }
}

/**
 * Creates the indexes declared on the `TableSlot` schema and then asserts the
 * guard index is really there.
 *
 * The schema declaration (`models/TableSlot.ts`) is the single source of truth
 * for what indexes exist; this function is the single place they are created.
 * Mongoose `autoIndex` is turned off in `db.ts`, so this call is the only
 * creation path and the only place a failure surfaces.
 */
export async function ensureSlotIndexes(): Promise<void> {
  try {
    await TableSlot.createIndexes();
  } catch (error) {
    if (errorCode(error) === INDEX_KEY_SPECS_CONFLICT) {
      // MongoDB's own message here is "An existing index has the same name as
      // the requested index", which never mentions uniqueness and sends an
      // operator looking for a naming problem. Name the real requirement.
      throw new Error(
        'STARTUP ABORTED: an index named `tableId_1_slotStart_1` already exists ' +
          'on the `tableSlots` collection with DIFFERENT options than this build ' +
          'requires. The required index is {tableId: 1, slotStart: 1} with ' +
          'unique: true, and that uniqueness is the only thing preventing double ' +
          'booking. If the existing index is not unique, the API is one restart ' +
          'away from silently double booking. Drop the existing index (or recreate ' +
          'it as unique), then restart.',
        { cause: error },
      );
    }
    throw error;
  }

  await assertSlotUniqueIndex();
}

/**
 * Attempts to take `SLOTS_PER_BOOKING` consecutive rows for one table.
 *
 * The insert is the arbitration: `{ ordered: false }` keeps going after the
 * first duplicate so a losing attempt may already own some of the rows. The
 * cleanup below is mandatory, not defensive - leaving those rows behind would
 * block a table that nobody booked.
 */
export async function reserveWindow(
  request: ReserveWindowRequest,
): Promise<ReserveWindowResult> {
  const { tableId, reservationId, slotStarts } = request;

  if (slotStarts.length !== SLOTS_PER_BOOKING) {
    throw new Error(
      `reserveWindow expects ${SLOTS_PER_BOOKING} slot instants, received ${slotStarts.length}.`,
    );
  }

  const rows = slotStarts.map((slotStart) => ({ tableId, slotStart, reservationId }));

  try {
    await TableSlot.insertMany(rows, { ordered: false });
    return { reserved: true };
  } catch (error) {
    await releaseWindow(reservationId);

    if (isDuplicateKeyError(error)) {
      return { reserved: false, reason: 'SLOT_TAKEN' };
    }
    throw error;
  }
}

/**
 * Removes every slot row owned by one reservation.
 *
 * Used on the failure paths of `reserveWindow`, and by Sprint 3 whenever a
 * reservation moves to a non-blocking status (see `holdsCapacity`).
 */
export async function releaseWindow(
  reservationId: mongoose.Types.ObjectId,
): Promise<number> {
  const result = await TableSlot.deleteMany({ reservationId });
  return result.deletedCount ?? 0;
}

/**
 * Slot rows for the given tables inside `[from, to]`, as plain values.
 *
 * This is the availability read. It lives here so that `services/booking.ts`
 * never has to name the collection.
 */
export async function findOccupiedSlots(
  tableIds: readonly mongoose.Types.ObjectId[],
  from: Date,
  to: Date,
): Promise<OccupiedSlot[]> {
  if (tableIds.length === 0) {
    return [];
  }

  const rows = await TableSlot.find({
    tableId: { $in: tableIds },
    slotStart: { $gte: from, $lte: to },
  })
    .select({ tableId: 1, slotStart: 1 })
    .lean();

  return rows.map((row) => ({
    tableId: String(row.tableId),
    slotStart: row.slotStart,
  }));
}

/**
 * Deletes slot rows whose `reservationId` has no matching reservation.
 *
 * This is the recovery path for a crash between `reserveWindow` and
 * `Reservation.create`: the rows exist, the reservation never will, and
 * `getAvailability` reads only `tableSlots`, so the table is blocked forever
 * with no reservation row for staff to cancel and no error anywhere.
 *
 * Safe to call at startup and on an interval. Rows newer than
 * `ORPHAN_GRACE_PERIOD_MS` are never touched, because an in-flight booking is
 * indistinguishable from an orphan until it finishes.
 *
 * Returns the number of rows removed. Callers log the COUNT only: these rows
 * belong to customer bookings.
 */
export async function reconcileOrphanedSlots(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - ORPHAN_GRACE_PERIOD_MS);

  const staleReservationIds: unknown[] = await TableSlot.distinct('reservationId', {
    createdAt: { $lt: cutoff },
  });
  if (staleReservationIds.length === 0) {
    return 0;
  }

  const liveReservations = await Reservation.find({
    _id: { $in: staleReservationIds },
  })
    .select({ _id: 1 })
    .lean();
  const liveIds = new Set(liveReservations.map((reservation) => String(reservation._id)));

  const orphanIds = staleReservationIds.filter((id) => !liveIds.has(String(id)));
  if (orphanIds.length === 0) {
    return 0;
  }

  const result = await TableSlot.deleteMany({ reservationId: { $in: orphanIds } });
  return result.deletedCount ?? 0;
}
