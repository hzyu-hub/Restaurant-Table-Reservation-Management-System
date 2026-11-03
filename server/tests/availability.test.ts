import { formatInTimeZone } from 'date-fns-tz';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RESTAURANT_TIMEZONE } from '../src/config/booking.js';
import { futureDateIso, pastDateIso, seedTables } from './helpers.js';

const app = createApp();

interface SlotPayload {
  startTime: string;
  endTime: string;
  available: boolean;
  tablesAvailable: number;
}

interface AvailabilityPayload {
  date: string;
  partySize: number;
  timezone: string;
  durationMinutes: number;
  slots: SlotPayload[];
}

describe('GET /api/availability', () => {
  it('returns all 20 bookable slots (11:00 through 20:30 local) for a valid date', async () => {
    await seedTables([2, 2, 4, 4, 6, 8]);
    const date = futureDateIso();

    const response = await request(app)
      .get('/api/availability')
      .query({ date, partySize: 2 });

    expect(response.status).toBe(200);
    const payload = response.body as AvailabilityPayload;

    expect(payload.timezone).toBe(RESTAURANT_TIMEZONE);
    expect(payload.durationMinutes).toBe(90);
    expect(payload.partySize).toBe(2);
    expect(payload.slots).toHaveLength(20);

    const localStarts = payload.slots.map((slot) =>
      formatInTimeZone(new Date(slot.startTime), RESTAURANT_TIMEZONE, 'HH:mm'),
    );
    expect(localStarts[0]).toBe('11:00');
    expect(localStarts[1]).toBe('11:30');
    expect(localStarts[localStarts.length - 1]).toBe('20:30');

    const localEnds = payload.slots.map((slot) =>
      formatInTimeZone(new Date(slot.endTime), RESTAURANT_TIMEZONE, 'HH:mm'),
    );
    expect(localEnds[localEnds.length - 1]).toBe('22:00');

    // Fresh day, nothing booked: all six tables are free at every start.
    expect(payload.slots.every((slot) => slot.available)).toBe(true);
    expect(payload.slots.every((slot) => slot.tablesAvailable === 6)).toBe(true);
  });

  it('marks every slot unavailable when the party is larger than every table', async () => {
    await seedTables([2, 2, 4, 4, 6, 8]);
    const date = futureDateIso();

    const response = await request(app)
      .get('/api/availability')
      .query({ date, partySize: 20 });

    expect(response.status).toBe(200);
    const payload = response.body as AvailabilityPayload;

    expect(payload.slots).toHaveLength(20);
    expect(payload.slots.every((slot) => slot.available === false)).toBe(true);
    expect(payload.slots.every((slot) => slot.tablesAvailable === 0)).toBe(true);
  });

  it('rejects a past date with a 400 DATE_IN_PAST', async () => {
    await seedTables([4]);

    const response = await request(app)
      .get('/api/availability')
      .query({ date: pastDateIso(), partySize: 2 });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: { code: 'DATE_IN_PAST' },
    });
  });

  it('requires both date and partySize', async () => {
    const noDate = await request(app)
      .get('/api/availability')
      .query({ partySize: 2 });
    expect(noDate.status).toBe(400);
    expect(noDate.body).toMatchObject({ error: { code: 'INVALID_DATE' } });

    const noParty = await request(app)
      .get('/api/availability')
      .query({ date: futureDateIso() });
    expect(noParty.status).toBe(400);
    expect(noParty.body).toMatchObject({ error: { code: 'INVALID_PARTY_SIZE' } });
  });

  it('rejects a malformed date and an out-of-range party size', async () => {
    const badDate = await request(app)
      .get('/api/availability')
      .query({ date: '2026-02-31', partySize: 2 });
    expect(badDate.status).toBe(400);
    expect(badDate.body).toMatchObject({ error: { code: 'INVALID_DATE' } });

    const badParty = await request(app)
      .get('/api/availability')
      .query({ date: futureDateIso(), partySize: 0 });
    expect(badParty.status).toBe(400);
    expect(badParty.body).toMatchObject({ error: { code: 'INVALID_PARTY_SIZE' } });
  });
});
