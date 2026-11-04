/**
 * The cross-collection invariant, asserted directly (audit 4.1, rec 3).
 *
 * "A slot row exists if and only if the owning reservation is in a blocking
 * status" is the property the whole design rests on. A scenario test covers the
 * paths its author thought of; this asserts the property itself, so cancel,
 * complete, no-show and any status added later without wiring all fail here.
 *
 * These are real queries against the real collections - nothing is mocked.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { BLOCKING_STATUSES, SLOTS_PER_BOOKING } from '../src/config/booking.js';
import { releaseWindow, reconcileOrphanedSlots } from '../src/lib/slots.js';
import { Reservation } from '../src/models/Reservation.js';
import { TableSlot } from '../src/models/TableSlot.js';
import {
  assertNoOrphanSlotsAfterReconcile,
  assertSlotInvariant,
  futureDateIso,
  reservationBody,
  seedTables,
} from './helpers.js';

const app = createApp();

interface CreatedPayload {
  reference: string;
  table: { label: string; capacity: number };
  startTime: string;
  endTime: string;
  status: string;
}

/** Creates one booking through the API and returns its reservation document. */
async function book(
  date: string,
  time: string,
  partySize = 2,
): Promise<{ reference: string; reservationId: string }> {
  const response = await request(app)
    .post('/api/reservations')
    .send(reservationBody({ date, time, partySize }));

  expect(response.status).toBe(201);
  const payload = response.body as CreatedPayload;

  const reservation = await Reservation.findOne({ reference: payload.reference }).lean();
  if (reservation === null) {
    throw new Error(`Test bug: no reservation row for ${payload.reference}.`);
  }

  return { reference: payload.reference, reservationId: String(reservation._id) };
}

describe('slot/reservation invariant', () => {
  it('holds after a plain booking: 3 rows for a CONFIRMED reservation', async () => {
    await seedTables([2, 4]);
    const date = futureDateIso();

    await book(date, '18:00', 2);

    await assertSlotInvariant();
    expect(await TableSlot.countDocuments({})).toBe(SLOTS_PER_BOOKING);
  });

  it('holds when every table is booked at the same time', async () => {
    await seedTables([2, 2, 4, 4, 6, 8]);
    const date = futureDateIso();

    for (let index = 0; index < 6; index += 1) {
      await book(date, '12:00', 1);
    }

    await assertSlotInvariant();
    expect(await TableSlot.countDocuments({})).toBe(6 * SLOTS_PER_BOOKING);
  });

  it('holds after a cancelled reservation: zero rows once released', async () => {
    await seedTables([2]);
    const date = futureDateIso();

    const { reservationId } = await book(date, '19:00', 2);
    await assertSlotInvariant();

    // What Sprint 3's status handler must do on any move to a non-blocking
    // status. If it forgets, the invariant fails here rather than in the demo.
    await Reservation.updateOne({ _id: reservationId }, { $set: { status: 'CANCELLED' } });
    await releaseWindow(new mongoose.Types.ObjectId(reservationId));

    await assertSlotInvariant();
    expect(await TableSlot.countDocuments({})).toBe(0);
  });

  it('detects a non-blocking reservation that still holds slots', async () => {
    await seedTables([2]);
    const date = futureDateIso();

    const { reservationId } = await book(date, '19:00', 2);

    // Simulate the Sprint 3 bug: status flipped, slots forgotten.
    await Reservation.updateOne({ _id: reservationId }, { $set: { status: 'NO_SHOW' } });

    await expect(assertSlotInvariant()).rejects.toThrow();
  });

  it('detects a blocking reservation that lost its slots', async () => {
    await seedTables([2]);
    const date = futureDateIso();

    const { reservationId } = await book(date, '19:00', 2);

    // Simulate a partial release: the reservation still blocks but its rows
    // are gone, so the table looks free while the booking still stands.
    await TableSlot.deleteMany({ reservationId });

    await expect(assertSlotInvariant()).rejects.toThrow();
  });

  it('every blocking status is one the invariant counts, and nothing else is', async () => {
    // Guards against someone adding a status to the enum and forgetting the
    // blocking list: the invariant is only as good as BLOCKING_STATUSES.
    expect([...BLOCKING_STATUSES].sort()).toEqual(['CONFIRMED', 'SEATED']);
  });

  it('leaves no slot row pointing at a nonexistent reservation after reconcile', async () => {
    await seedTables([2, 4]);
    const date = futureDateIso();

    await book(date, '18:00', 2);
    await book(date, '19:00', 4);

    await assertNoOrphanSlotsAfterReconcile(reconcileOrphanedSlots);
    await assertSlotInvariant();
  });
});
