/**
 * Sprint 3b: staff status changes.
 *
 * A legal transition is saved. An illegal one is rejected and changes nothing.
 * Leaving the blocking set releases that reservation's slots, and only those,
 * so the table can be booked again. Seating keeps the table held.
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StaffUser } from '../src/models/StaffUser.js';
import { assertSlotInvariant, futureDateIso, reservationBody, seedTables } from './helpers.js';

const STAFF_USERNAME = 'staff';
const STAFF_PASSWORD = 'correct-horse-battery';

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface CreatedReservation {
  reference: string;
  status: string;
  table: { label: string; capacity: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function errorBody(value: unknown): ErrorBody {
  if (!isRecord(value) || !isRecord(value.error)) {
    throw new Error('Response is not an API error payload.');
  }
  if (typeof value.error.code !== 'string' || typeof value.error.message !== 'string') {
    throw new Error('API error payload is missing code or message.');
  }
  return { error: { code: value.error.code, message: value.error.message } };
}

async function staffToken(): Promise<string> {
  await StaffUser.create({
    username: STAFF_USERNAME,
    passwordHash: await bcrypt.hash(STAFF_PASSWORD, 4),
    role: 'staff',
  });
  const response = await request(createApp())
    .post('/api/auth/login')
    .send({ username: STAFF_USERNAME, password: STAFF_PASSWORD });
  expect(response.status).toBe(200);
  if (!isRecord(response.body) || typeof response.body.token !== 'string') {
    throw new Error('Login did not return a token.');
  }
  return response.body.token;
}

async function book(date: string, time: string, partySize: number): Promise<CreatedReservation> {
  const response = await request(createApp())
    .post('/api/reservations')
    .send(reservationBody({ date, time, partySize }));
  expect(response.status).toBe(201);
  const body = response.body as CreatedReservation;
  if (typeof body.reference !== 'string') {
    throw new Error('Booking did not return a reference.');
  }
  return body;
}

describe('PATCH /api/staff/reservations/:reference/status', () => {
  it('rejects a status change without a staff token', async () => {
    const response = await request(createApp())
      .patch('/api/staff/reservations/ABC1234/status')
      .send({ status: 'SEATED' });

    expect(response.status).toBe(401);
    expect(errorBody(response.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('seats a confirmed reservation and keeps its slots held', async () => {
    const token = await staffToken();
    await seedTables([2]);
    const date = futureDateIso();
    const created = await book(date, '18:00', 2);

    const response = await request(createApp())
      .patch(`/api/staff/reservations/${created.reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SEATED' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reference: created.reference,
      status: 'SEATED',
      table: { label: 'T1' },
    });
    await assertSlotInvariant();

    const again = await request(createApp())
      .post('/api/reservations')
      .send(reservationBody({ date, time: '18:00', partySize: 2, customerName: 'Grace Hopper' }));
    expect(again.status).toBe(409);
  });

  it('cancels a reservation, frees only its slots, and accepts a repeat', async () => {
    const token = await staffToken();
    await seedTables([2, 2]);
    const date = futureDateIso();
    const first = await book(date, '18:00', 2);
    const second = await book(date, '18:00', 2);

    const cancelled = await request(createApp())
      .patch(`/api/staff/reservations/${first.reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });
    await assertSlotInvariant();

    const repeated = await request(createApp())
      .patch(`/api/staff/reservations/${first.reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'CANCELLED' });
    expect(repeated.status).toBe(200);
    expect(repeated.body).toMatchObject({ status: 'CANCELLED' });
    await assertSlotInvariant();

    const rebooked = await request(createApp())
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '18:00',
          partySize: 2,
          customerName: 'Grace Hopper',
        }),
      );
    expect(rebooked.status).toBe(201);
    await assertSlotInvariant();

    const stillHeld = await request(createApp())
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '18:00',
          partySize: 2,
          customerName: 'Katherine Johnson',
        }),
      );
    expect(stillHeld.status).toBe(409);
    expect(second.reference).not.toBe(first.reference);
  });

  it('rejects an illegal transition and leaves the reservation unchanged', async () => {
    const token = await staffToken();
    await seedTables([4]);
    const created = await book(futureDateIso(), '12:00', 4);

    const response = await request(createApp())
      .patch(`/api/staff/reservations/${created.reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'COMPLETED' });

    expect(response.status).toBe(409);
    expect(errorBody(response.body).error.code).toBe('INVALID_TRANSITION');
    await assertSlotInvariant();

    const list = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', `Bearer ${token}`)
      .query({ date: futureDateIso() });
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      reservations: [{ reference: created.reference, status: 'CONFIRMED' }],
    });
  });

  it('rejects a status the system does not understand', async () => {
    const token = await staffToken();
    await seedTables([2]);
    const created = await book(futureDateIso(), '19:00', 2);

    const response = await request(createApp())
      .patch(`/api/staff/reservations/${created.reference}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PENDING' });

    expect(response.status).toBe(400);
    expect(errorBody(response.body).error.code).toBe('INVALID_STATUS');
    await assertSlotInvariant();
  });

  it('returns not found for an unknown reference', async () => {
    const token = await staffToken();
    const response = await request(createApp())
      .patch('/api/staff/reservations/NO-SUCH/status')
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SEATED' });

    expect(response.status).toBe(404);
    expect(errorBody(response.body).error.code).toBe('NOT_FOUND');
  });
});
