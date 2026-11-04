/**
 * Test helpers. `futureDateIso` picks a date a few weeks ahead in the
 * restaurant's timezone, which is always inside service hours for a `T12:00`
 * style request and avoids DST edge days.
 */
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { expect } from 'vitest';
import {
  BLOCKING_STATUSES,
  RESTAURANT_TIMEZONE,
  SLOTS_PER_BOOKING,
  type ReservationStatus,
} from '../src/config/booking.js';
import { Reservation } from '../src/models/Reservation.js';
// Direct model access from TESTS is deliberate and allowed: the architecture
// rule in `tests/architecture.test.ts` governs `server/src` only, and the
// invariant assertion below has to count raw slot rows to be a real check.
// Production code never imports this model outside `src/lib/slots.ts`.
import { TableSlot } from '../src/models/TableSlot.js';
import { Table } from '../src/models/Table.js';

/** A local calendar date `offsetDays` from now, as `YYYY-MM-DD`. */
export function futureDateIso(offsetDays = 14): string {
  const target = addDays(new Date(), offsetDays);
  return formatInTimeZone(target, RESTAURANT_TIMEZONE, 'yyyy-MM-dd');
}

/** A local calendar date in the past, as `YYYY-MM-DD`. */
export function pastDateIso(offsetDays = 7): string {
  const target = addDays(new Date(), -offsetDays);
  return formatInTimeZone(target, RESTAURANT_TIMEZONE, 'yyyy-MM-dd');
}

/** Creates tables from a capacity list, labelled T1..Tn. */
export async function seedTables(capacities: number[]): Promise<
  { _id: unknown; label: string; capacity: number }[]
> {
  const documents = capacities.map((capacity, index) => ({
    label: `T${index + 1}`,
    capacity,
    active: true,
  }));

  await Table.insertMany(documents);
  const created = await Table.find().sort({ label: 1 }).lean();
  return created.map((table) => ({
    _id: table._id,
    label: table.label,
    capacity: table.capacity,
  }));
}

/** A valid reservation body for the given date/time/party size. */
export function reservationBody(overrides: {
  date: string;
  time?: string;
  partySize?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    customerName: overrides.customerName ?? 'Ada Lovelace',
    customerPhone: overrides.customerPhone ?? '416-555-0142',
    partySize: overrides.partySize ?? 2,
    date: overrides.date,
    time: overrides.time ?? '18:00',
  };

  if (overrides.customerEmail !== undefined) {
    body.customerEmail = overrides.customerEmail;
  }

  return body;
}

/** True when `status` is one that occupies its table. */
function blocksCapacity(status: string): boolean {
  return (BLOCKING_STATUSES as readonly string[]).includes(status);
}

/**
 * Asserts the cross-collection invariant directly, as a query pair, instead of
 * testing one scenario (audit 4.1, rec 3).
 *
 * For EVERY reservation:
 * - if its status is blocking, exactly `SLOTS_PER_BOOKING` slot rows exist for
 *   that reservation id, and each one sits on its table inside its window;
 * - if its status is not blocking, zero slot rows exist for it.
 *
 * And globally: no slot row references a reservation that does not exist. Call
 * this after any operation that could touch either collection - it catches
 * cancel, complete, no-show, a future status added without wiring, and orphaned
 * rows, all at once.
 *
 * Throws (via `expect`) rather than returning a boolean, so a failure names the
 * offending reservation.
 */
export async function assertSlotInvariant(): Promise<void> {
  const reservations = await Reservation.find({}).lean();
  const reservationIds = reservations.map((reservation) => reservation._id);

  const rowsByReservation = new Map<string, { slotStart: Date; tableId: string }[]>();
  const allRows = await TableSlot.find({}).select({ reservationId: 1, slotStart: 1, tableId: 1 }).lean();
  for (const row of allRows) {
    const key = String(row.reservationId);
    const bucket = rowsByReservation.get(key) ?? [];
    bucket.push({ slotStart: row.slotStart, tableId: String(row.tableId) });
    rowsByReservation.set(key, bucket);
  }

  for (const reservation of reservations) {
    const key = String(reservation._id);
    const rows = rowsByReservation.get(key) ?? [];
    const status = reservation.status as ReservationStatus;
    const label = `reservation ${reservation.reference} (${status})`;

    if (blocksCapacity(status)) {
      expect(rows, `${label} must own ${SLOTS_PER_BOOKING} slot rows`).toHaveLength(
        SLOTS_PER_BOOKING,
      );

      const windowStart = reservation.startTime.getTime();
      const windowEnd = reservation.endTime.getTime();
      for (const row of rows) {
        expect(row.tableId, `${label} has a slot row on the wrong table`).toBe(
          String(reservation.tableId),
        );
        const instant = row.slotStart.getTime();
        expect(
          instant >= windowStart && instant < windowEnd,
          `${label} has a slot row outside its window`,
        ).toBe(true);
      }
    } else {
      expect(rows, `${label} must own no slot rows`).toHaveLength(0);
    }
  }

  // No slot row may point at a reservation that does not exist. Orphans can
  // only come from a crash between the two writes, which the reconciler
  // repairs; before the reconciler runs they are legal, so callers that care
  // run it first.
  const knownIds = new Set(reservationIds.map((id) => String(id)));
  const orphanIds = [...rowsByReservation.keys()].filter((id) => !knownIds.has(id));
  expect(orphanIds, 'slot rows reference nonexistent reservations').toEqual([]);
}

/**
 * Asserts no slot row references a nonexistent reservation, after running the
 * reconciler with no grace period.
 *
 * Separate from `assertSlotInvariant` because orphan repair is explicitly
 * time-delayed: an in-flight booking is indistinguishable from an orphan.
 */
export async function assertNoOrphanSlotsAfterReconcile(
  reconcile: (now?: Date) => Promise<number>,
): Promise<void> {
  // Push "now" past the grace period so nothing is treated as in-flight.
  await reconcile(new Date(Date.now() + 10 * 60_000));

  const reservations = await Reservation.find({}).select({ _id: 1 }).lean();
  const knownIds = new Set(reservations.map((reservation) => String(reservation._id)));

  const rows = await TableSlot.find({}).select({ reservationId: 1 }).lean();
  const orphanIds = rows
    .map((row) => String(row.reservationId))
    .filter((id) => !knownIds.has(id));

  expect(orphanIds, 'orphaned slot rows survived the reconciler').toEqual([]);
}
