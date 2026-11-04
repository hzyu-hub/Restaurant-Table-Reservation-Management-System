/**
 * Orphaned slot rows (audit 4.2, rec 4).
 *
 * `createReservation` secures slot rows BEFORE writing the reservation, so a
 * crash in between leaves a table blocked with no reservation row, no log, and
 * nothing for staff to cancel. The reconciler repairs that - but only for rows
 * older than the grace period, because until then an in-flight booking looks
 * exactly the same.
 */
import mongoose from 'mongoose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ORPHAN_GRACE_PERIOD_MS, reconcileOrphanedSlots } from '../src/lib/slots.js';
import { Reservation } from '../src/models/Reservation.js';
import { TableSlot } from '../src/models/TableSlot.js';
import { futureDateIso, reservationBody, seedTables } from './helpers.js';

const app = createApp();

/** Writes `count` slot rows for a reservation id that will never exist. */
async function writeOrphanSlots(
  tableId: mongoose.Types.ObjectId,
  reservationId: mongoose.Types.ObjectId,
  createdAt: Date,
  count = 3,
): Promise<void> {
  const base = Date.now();
  const rows = Array.from({ length: count }, (_unused, index) => ({
    tableId,
    reservationId,
    slotStart: new Date(base + index * 30 * 60_000),
    // `timestamps: true` would normally set this; set it explicitly so the
    // grace-period boundary can be tested without waiting a minute.
    createdAt,
    updatedAt: createdAt,
  }));

  await TableSlot.insertMany(rows);
}

describe('reconcileOrphanedSlots', () => {
  it('deletes an orphaned slot row older than the grace period', async () => {
    const [table] = await seedTables([4]);
    const orphanReservationId = new mongoose.Types.ObjectId();
    const old = new Date(Date.now() - ORPHAN_GRACE_PERIOD_MS - 60_000);

    await writeOrphanSlots(
      new mongoose.Types.ObjectId(String(table._id)),
      orphanReservationId,
      old,
    );
    expect(await TableSlot.countDocuments({})).toBe(3);

    const removed = await reconcileOrphanedSlots();

    expect(removed).toBe(3);
    expect(await TableSlot.countDocuments({})).toBe(0);
  });

  it('keeps an orphaned slot row younger than the grace period (in-flight booking)', async () => {
    const [table] = await seedTables([4]);
    const orphanReservationId = new mongoose.Types.ObjectId();

    await writeOrphanSlots(
      new mongoose.Types.ObjectId(String(table._id)),
      orphanReservationId,
      new Date(),
    );

    const removed = await reconcileOrphanedSlots();

    // This is the critical case: deleting here would yank rows out from under
    // a booking that is still being written, re-opening the double-booking race.
    expect(removed).toBe(0);
    expect(await TableSlot.countDocuments({})).toBe(3);
  });

  it('never touches slots owned by a real reservation, however old', async () => {
    await seedTables([4]);
    const date = futureDateIso();

    const response = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '18:00', partySize: 2 }));
    expect(response.status).toBe(201);

    // Age the rows well past the grace period: they are still legitimate
    // because the reservation exists.
    await TableSlot.updateMany({}, { $set: { createdAt: new Date(0) } });

    const removed = await reconcileOrphanedSlots();

    expect(removed).toBe(0);
    expect(await TableSlot.countDocuments({})).toBe(3);
    expect(await Reservation.countDocuments({})).toBe(1);
  });

  it('reports a count and leaves live rows alone in a mixed collection', async () => {
    const tables = await seedTables([4, 4]);
    const date = futureDateIso();

    const response = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '18:00', partySize: 2 }));
    expect(response.status).toBe(201);
    await TableSlot.updateMany({}, { $set: { createdAt: new Date(0) } });

    const orphanId = new mongoose.Types.ObjectId();
    await writeOrphanSlots(
      new mongoose.Types.ObjectId(String(tables[1]._id)),
      orphanId,
      new Date(Date.now() - ORPHAN_GRACE_PERIOD_MS - 60_000),
    );

    expect(await TableSlot.countDocuments({})).toBe(6);

    const removed = await reconcileOrphanedSlots();

    expect(removed).toBe(3);
    // The real booking's rows survived.
    const remaining = await TableSlot.find({}).select({ reservationId: 1 }).lean();
    expect(remaining).toHaveLength(3);
    expect(String(remaining[0].reservationId)).not.toBe(String(orphanId));
  });

  it('is a no-op on an empty collection', async () => {
    await seedTables([4]);
    expect(await reconcileOrphanedSlots()).toBe(0);
  });
});
