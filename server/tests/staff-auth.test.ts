/**
 * Sprint 3a: staff login and the read-only reservation list.
 *
 * These tests describe the contract before the routes exist:
 * - a valid login returns a bearer token, never a cookie
 * - unknown users and wrong passwords are indistinguishable
 * - staff endpoints reject missing or invalid tokens
 * - an authorized staff member sees one local date, with contact details
 */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StaffUser } from '../src/models/StaffUser.js';
import { futureDateIso, reservationBody, seedTables } from './helpers.js';

const STAFF_USERNAME = 'staff';
const STAFF_PASSWORD = 'correct-horse-battery';
const BCRYPT_ROUNDS = 4;

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

interface LoginBody {
  token: string;
  tokenType: string;
  expiresInSeconds: number;
  staff: {
    username: string;
    role: string;
  };
}

interface StaffReservation {
  reference: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  partySize: number;
  table: {
    label: string;
    capacity: number;
  };
  startTime: string;
  endTime: string;
  status: string;
}

interface StaffListBody {
  date: string;
  timezone: string;
  reservations: StaffReservation[];
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

async function seedStaff(username = STAFF_USERNAME, password = STAFF_PASSWORD): Promise<void> {
  await StaffUser.create({
    username,
    passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
    role: 'staff',
  });
}

async function login(
  username = STAFF_USERNAME,
  password = STAFF_PASSWORD,
): Promise<LoginBody> {
  const response = await request(createApp())
    .post('/api/auth/login')
    .send({ username, password });

  expect(response.status).toBe(200);
  if (
    !isRecord(response.body) ||
    typeof response.body.token !== 'string' ||
    response.body.tokenType !== 'Bearer' ||
    typeof response.body.expiresInSeconds !== 'number' ||
    !isRecord(response.body.staff) ||
    typeof response.body.staff.username !== 'string' ||
    (response.body.staff.role !== 'staff' && response.body.staff.role !== 'admin')
  ) {
    throw new Error('Login did not return a staff session.');
  }

  return {
    token: response.body.token,
    tokenType: 'Bearer',
    expiresInSeconds: response.body.expiresInSeconds,
    staff: {
      username: response.body.staff.username,
      role: response.body.staff.role,
    },
  };
}

describe('POST /api/auth/login', () => {
  it('returns a bearer token for valid staff credentials', async () => {
    await seedStaff();

    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ username: ' Staff ', password: STAFF_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body).toMatchObject({
      tokenType: 'Bearer',
      staff: { username: STAFF_USERNAME, role: 'staff' },
    });

    const body = response.body as LoginBody;
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.expiresInSeconds).toBeGreaterThan(0);
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects a wrong password and an unknown user with the same response', async () => {
    await seedStaff();

    const wrongPassword = await request(createApp())
      .post('/api/auth/login')
      .send({ username: STAFF_USERNAME, password: 'wrong-password' });
    const unknownUser = await request(createApp())
      .post('/api/auth/login')
      .send({ username: 'nobody', password: STAFF_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownUser.status).toBe(401);
    expect(errorBody(unknownUser.body)).toEqual(errorBody(wrongPassword.body));
    expect(errorBody(wrongPassword.body).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses to sign a token when JWT_SECRET is missing', async () => {
    await seedStaff();
    const previousSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;

    try {
      const response = await request(createApp())
        .post('/api/auth/login')
        .send({ username: STAFF_USERNAME, password: STAFF_PASSWORD });

      expect(response.status).toBe(500);
      expect(errorBody(response.body).error.code).toBe('AUTH_NOT_CONFIGURED');
    } finally {
      if (previousSecret !== undefined) {
        process.env.JWT_SECRET = previousSecret;
      }
    }
  });

  it('rejects a missing password before looking up a user', async () => {
    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ username: STAFF_USERNAME });

    expect(response.status).toBe(400);
    expect(errorBody(response.body).error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /api/staff/reservations', () => {
  it('rejects a request without a token', async () => {
    const response = await request(createApp()).get('/api/staff/reservations').query({
      date: futureDateIso(),
    });

    expect(response.status).toBe(401);
    expect(errorBody(response.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token that was not issued by this server', async () => {
    const response = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', 'Bearer not-a-real-token')
      .query({ date: futureDateIso() });

    expect(response.status).toBe(401);
    expect(errorBody(response.body).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns one local date for an authorized staff member, including contact details', async () => {
    await seedStaff();
    await seedTables([2, 4]);
    const date = futureDateIso();
    const otherDate = futureDateIso(15);

    const first = await request(createApp())
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '18:00',
          partySize: 2,
          customerName: 'Ada Lovelace',
          customerEmail: 'ada@example.com',
          customerPhone: '416-555-0142',
        }),
      );
    const second = await request(createApp())
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '12:00',
          partySize: 4,
          customerName: 'Grace Hopper',
          customerPhone: '416-555-0134',
        }),
      );
    const otherDay = await request(createApp())
      .post('/api/reservations')
      .send(reservationBody({ date: otherDate, time: '18:00', partySize: 2 }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(otherDay.status).toBe(201);

    const session = await login();
    const response = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', `Bearer ${session.token}`)
      .query({ date });

    expect(response.status).toBe(200);
    const body = response.body as StaffListBody;
    expect(body.date).toBe(date);
    expect(body.timezone).toBe('America/Toronto');
    expect(body.reservations.map((reservation) => reservation.customerName)).toEqual([
      'Grace Hopper',
      'Ada Lovelace',
    ]);
    expect(body.reservations[1]).toMatchObject({
      reference: (first.body as { reference: string }).reference,
      customerEmail: 'ada@example.com',
      customerPhone: '416-555-0142',
      partySize: 2,
      table: { label: 'T1', capacity: 2 },
      status: 'CONFIRMED',
    });
    expect(body.reservations[0]?.customerEmail).toBeNull();
  });

  it('keeps a late booking on its restaurant-local date across the UTC day boundary', async () => {
    await seedStaff();
    await seedTables([2]);
    const date = '2026-11-17';

    const created = await request(createApp())
      .post('/api/reservations')
      .send(
        reservationBody({
          date,
          time: '20:30',
          partySize: 2,
          customerName: 'Ada Lovelace',
        }),
      );
    expect(created.status).toBe(201);

    const session = await login();
    const sameDay = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', `Bearer ${session.token}`)
      .query({ date });
    const nextDay = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', `Bearer ${session.token}`)
      .query({ date: '2026-11-18' });

    expect(sameDay.status).toBe(200);
    expect(nextDay.status).toBe(200);
    expect((sameDay.body as StaffListBody).reservations).toHaveLength(1);
    expect((nextDay.body as StaffListBody).reservations).toHaveLength(0);
  });

  it('rejects a staff date query that is not a calendar date', async () => {
    await seedStaff();
    const session = await login();

    const response = await request(createApp())
      .get('/api/staff/reservations')
      .set('Authorization', `Bearer ${session.token}`)
      .query({ date: 'tomorrow' });

    expect(response.status).toBe(400);
    expect(errorBody(response.body).error.code).toBe('INVALID_DATE');
  });
});
