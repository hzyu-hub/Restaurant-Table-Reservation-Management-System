/**
 * FR4 — the concurrency guard.
 *
 * One table, five simultaneous requests for the same window. The unique
 * `{tableId, slotStart}` index must let exactly one through. Anything else
 * (two 201s, or four 409s plus leftover slot rows) means the guard regressed.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bookableSlotIndex, bookingSlotInstants, clockTimeToMinutes } from '../src/lib/time.js';
import { TableSlot } from '../src/models/TableSlot.js';
import { futureDateIso, reservationBody, seedTables } from './helpers.js';

const app = createApp();

const PARALLEL_REQUESTS = 5;

describe('concurrency guard (FR4)', () => {
  it('lets exactly 1 of 5 parallel identical bookings win, leaving 3 slot rows', async () => {
    const [table] = await seedTables([4]);
    const date = futureDateIso();
    const time = '19:00';
    const body = reservationBody({ date, time, partySize: 4 });

    const responses = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () =>
        request(app).post('/api/reservations').send(body),
      ),
    );

    const statuses = responses.map((response) => response.status);
    const created = statuses.filter((status) => status === 201);
    const conflicts = statuses.filter((status) => status === 409);

    expect(statuses).toHaveLength(PARALLEL_REQUESTS);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(4);

    // No request may fail with a 5xx: a duplicate key is an expected outcome.
    expect(statuses.filter((status) => status >= 500)).toHaveLength(0);

    const winners = responses.filter((response) => response.status === 201);
    expect(winners[0].body).toMatchObject({
      status: 'CONFIRMED',
      partySize: 4,
      table: { capacity: 4 },
    });

    for (const response of responses.filter((item) => item.status === 409)) {
      expect(response.body).toMatchObject({ error: { code: 'BOOKING_CONFLICT' } });
    }

    // The winner owns exactly the 3 slots of its 90 minute window — no extras
    // left behind by the losers' partial `ordered: false` inserts.
    const minutes = clockTimeToMinutes(time);
    if (minutes === null) {
      throw new Error(`Test bug: ${time} is not a clock time.`);
    }
    const windowInstants = bookingSlotInstants(date, bookableSlotIndex(minutes));

    const slotsForWindow = await TableSlot.countDocuments({
      tableId: table._id,
      slotStart: { $in: windowInstants },
    });
    expect(slotsForWindow).toBe(3);

    // And nothing at all for that table on that day beyond the winning window.
    const allSlotsForTable = await TableSlot.countDocuments({ tableId: table._id });
    expect(allSlotsForTable).toBe(3);
  });

  it('does not leak partial slot rows when the race spans two candidate tables', async () => {
    // Two equal-capacity tables, so two separate requests can legitimately win
    // (one per table). What must NOT happen is a loser leaving rows behind:
    // the total row count has to be exactly 3 per successful booking.
    await seedTables([4, 4]);
    const date = futureDateIso();
    const body = reservationBody({ date, time: '12:30', partySize: 3 });

    const responses = await Promise.all(
      Array.from({ length: PARALLEL_REQUESTS }, () =>
        request(app).post('/api/reservations').send(body),
      ),
    );

    const created = responses.filter((response) => response.status === 201);
    const conflicts = responses.filter((response) => response.status === 409);

    expect(created).toHaveLength(2);
    expect(conflicts).toHaveLength(3);

    // Each winner owns its own table and exactly 3 rows; no orphaned partials.
    const winningTables = new Set(
      created.map((response) => (response.body as { table: { label: string } }).table.label),
    );
    expect(winningTables.size).toBe(2);

    const totalSlots = await TableSlot.countDocuments({});
    expect(totalSlots).toBe(created.length * 3);
  });
});
