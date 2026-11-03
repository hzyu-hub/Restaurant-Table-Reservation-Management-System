import { formatInTimeZone } from 'date-fns-tz';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RESTAURANT_TIMEZONE } from '../src/config/booking.js';
import { bookingSlotInstants, bookableSlotIndex, clockTimeToMinutes } from '../src/lib/time.js';
import { TableSlot } from '../src/models/TableSlot.js';
import { futureDateIso, pastDateIso, reservationBody, seedTables } from './helpers.js';

const app = createApp();

interface CreatedPayload {
  reference: string;
  table: { label: string; capacity: number };
  startTime: string;
  endTime: string;
  status: string;
  customerName: string;
  partySize: number;
}

/** The 3 UTC slot instants a booking at `time` on `date` must own. */
function expectedSlotInstants(date: string, time: string): Date[] {
  const minutes = clockTimeToMinutes(time);
  if (minutes === null) {
    throw new Error(`Test bug: ${time} is not a clock time.`);
  }
  return bookingSlotInstants(date, bookableSlotIndex(minutes));
}

describe('POST /api/reservations', () => {
  it('creates a reservation, returns a reference, and writes exactly 3 slot rows', async () => {
    const tables = await seedTables([2, 4, 8]);
    const date = futureDateIso();

    const response = await request(app)
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '18:00',
          partySize: 2,
          customerEmail: 'ada@example.com',
        }),
      );

    expect(response.status).toBe(201);
    const payload = response.body as CreatedPayload;

    expect(payload.reference).toMatch(/^R[23456789A-HJ-NP-Z]{7}$/);
    expect(payload.status).toBe('CONFIRMED');
    expect(payload.partySize).toBe(2);
    expect(payload.customerName).toBe('Ada Lovelace');

    // Best fit: the capacity-2 table, not the 8-seater.
    expect(payload.table.capacity).toBe(2);
    expect(payload.table.label).toBe(tables[0].label);

    expect(
      formatInTimeZone(new Date(payload.startTime), RESTAURANT_TIMEZONE, 'HH:mm'),
    ).toBe('18:00');
    expect(
      formatInTimeZone(new Date(payload.endTime), RESTAURANT_TIMEZONE, 'HH:mm'),
    ).toBe('19:30');

    const slotRows = await TableSlot.find({}).lean();
    expect(slotRows).toHaveLength(3);

    const expected = expectedSlotInstants(date, '18:00').map((instant) =>
      instant.getTime(),
    );
    const actual = slotRows
      .map((row) => row.slotStart.getTime())
      .sort((left, right) => left - right);
    expect(actual).toEqual(expected);
  });

  it('rejects an invalid name', async () => {
    await seedTables([4]);

    const shortName = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), customerName: 'A' }));
    expect(shortName.status).toBe(400);
    expect(shortName.body).toMatchObject({ error: { code: 'INVALID_NAME' } });

    const numericName = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), customerName: '1234' }));
    expect(numericName.status).toBe(400);
    expect(numericName.body).toMatchObject({ error: { code: 'INVALID_NAME' } });

    const missingName = await request(app)
      .post('/api/reservations')
      .send({ ...reservationBody({ date: futureDateIso() }), customerName: undefined });
    expect(missingName.status).toBe(400);
    expect(missingName.body).toMatchObject({ error: { code: 'INVALID_NAME' } });
  });

  it('rejects an invalid phone number', async () => {
    await seedTables([4]);

    const letters = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), customerPhone: 'call-me-maybe' }));
    expect(letters.status).toBe(400);
    expect(letters.body).toMatchObject({ error: { code: 'INVALID_PHONE' } });

    const tooShort = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), customerPhone: '12345' }));
    expect(tooShort.status).toBe(400);
    expect(tooShort.body).toMatchObject({ error: { code: 'INVALID_PHONE' } });
  });

  it('rejects a non-grid start time such as 11:15', async () => {
    await seedTables([4]);

    const response = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), time: '11:15' }));

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_TIME' } });
  });

  it('rejects bookings outside 11:00-20:30 service hours', async () => {
    await seedTables([4]);
    const date = futureDateIso();

    const tooEarly = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '10:30' }));
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body).toMatchObject({ error: { code: 'OUTSIDE_SERVICE_HOURS' } });

    const tooLate = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '21:00' }));
    expect(tooLate.status).toBe(400);
    expect(tooLate.body).toMatchObject({ error: { code: 'OUTSIDE_SERVICE_HOURS' } });

    // The last legal start time must still work.
    const lastSlot = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '20:30' }));
    expect(lastSlot.status).toBe(201);
  });

  it('rejects a start time in the past', async () => {
    await seedTables([4]);

    const pastDate = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: pastDateIso(), time: '19:00' }));

    expect(pastDate.status).toBe(400);
    expect(pastDate.body).toMatchObject({
      error: { code: 'RESERVATION_IN_PAST' },
    });
  });

  it('returns 409 NO_TABLE_AVAILABLE when no table fits the party', async () => {
    await seedTables([2, 4]);

    const response = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date: futureDateIso(), partySize: 10 }));

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'NO_TABLE_AVAILABLE' } });
  });

  it('assigns every one of the six seeded tables before reporting a conflict', async () => {
    // Regression: the candidate list must not be truncated, or the largest
    // tables become unbookable once the smaller ones are taken.
    await seedTables([2, 2, 4, 4, 6, 8]);
    const date = futureDateIso();

    const labels: string[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app)
        .post('/api/reservations')
        .send(reservationBody({ date, time: '12:00', partySize: 1 }));
      expect(response.status).toBe(201);
      labels.push((response.body as CreatedPayload).table.label);
    }

    expect(labels).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    expect(await TableSlot.countDocuments({})).toBe(18);

    const overflow = await request(app)
      .post('/api/reservations')
      .send(reservationBody({ date, time: '12:00', partySize: 1 }));
    expect(overflow.status).toBe(409);
    expect(overflow.body).toMatchObject({ error: { code: 'BOOKING_CONFLICT' } });

    // Availability agrees: nothing left at noon, but later slots are open.
    const availability = await request(app)
      .get('/api/availability')
      .query({ date, partySize: 1 });
    const noon = (
      availability.body as { slots: { startTime: string; available: boolean }[] }
    ).slots.find((slot) => slot.startTime.endsWith('17:00:00.000Z'));
    expect(noon?.available).toBe(false);
  });

  it('returns 409 BOOKING_CONFLICT when every fitting table is taken', async () => {
    await seedTables([2]);
    const date = futureDateIso();
    const body = reservationBody({ date, time: '19:00', partySize: 2 });

    const first = await request(app).post('/api/reservations').send(body);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/reservations').send(body);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: { code: 'BOOKING_CONFLICT' } });

    // The failed attempt must not leave orphan slot rows behind.
    const slotRows = await TableSlot.find({}).lean();
    expect(slotRows).toHaveLength(3);
  });
});
