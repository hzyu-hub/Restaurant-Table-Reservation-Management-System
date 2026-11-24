import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { StaffUser } from '../src/models/StaffUser.js';
import { Reservation } from '../src/models/Reservation.js';
import { staffAuthorization } from './auth-helper.js';
import { futureDateIso, reservationBody, seedTables } from './helpers.js';

const app = createApp();
const registration = {
  username: 'river', password: 'example-password-123', name: ['River', 'Lane'].join(' '),
  phone: ['416', '555', '0100'].join(''),
};
async function register(username = 'river', email?: string) {
  const response = await request(app).post('/api/auth/register').send({ ...registration, username, email });
  expect(response.status).toBe(201);
  return response.body as { token: string; user: { id: string } };
}
async function book(token: string, time = '18:00', extra: Record<string, unknown> = {}) {
  return request(app).post('/api/reservations').set('Authorization', `Bearer ${token}`)
    .send({ ...reservationBody({ date: futureDateIso(), time }), ...extra });
}

describe('customer accounts', () => {
  it('registers a canonical customer and logs in with the shared profile without exposing hashes', async () => {
    const response = await request(app).post('/api/auth/register').send({ ...registration, username: ' ' + 'river'.toUpperCase() + ' ' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ tokenType: 'Bearer', expiresInSeconds: 28800,
      user: { username: 'river', role: 'customer', name: ['River', 'Lane'].join(' '), phone: registration.phone, email: null } });
    const session = response.body as { token: string; user: { id: string } };
    expect(session.user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(JSON.stringify(response.body)).not.toContain('password');
    expect(response.body).not.toHaveProperty('staff');
    const account = await StaffUser.findOne({ username: 'river' }).lean();
    expect(account).not.toHaveProperty('passwordHash');
    const login = await request(app).post('/api/auth/login').send({ username: ' RIVER ', password: registration.password });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual(response.body.user);
  });

  it.each(['staff', 'admin'])('never grants requested %s access', async (role) => {
    const response = await request(app).post('/api/auth/register').send({ ...registration, role });
    expect([201, 400]).toContain(response.status);
    expect(await StaffUser.countDocuments({ role: { $in: ['staff', 'admin'] }, username: 'river' })).toBe(0);
    if (response.status === 201) expect(response.body.user.role).toBe('customer');
  });

  it.each([
    { username: { $ne: null } }, { username: 'bad name' }, { username: 'x'.repeat(65) },
    { password: 'short' }, { password: 'x'.repeat(73) }, { password: 'é'.repeat(37) }, { name: '' },
    { phone: 'abc' }, { email: 'invalid' }, { email: 12 },
  ])('validates registration at the boundary: %j', async (invalid) => {
    const response = await request(app).post('/api/auth/register').send({ ...registration, ...invalid });
    expect(response.status).toBe(400);
    expect(await StaffUser.countDocuments({ username: 'river' })).toBe(0);
  });

  it('normalizes optional email', async () => {
    const response = await request(app).post('/api/auth/register').send({ ...registration, email: ' River@Example.com ' });
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe('river@example.com');
  });

  it('arbitrates concurrent canonical duplicates with the unique account index', async () => {
    const responses = await Promise.all(['River', ' river '].map((username) =>
      request(app).post('/api/auth/register').send({ ...registration, username })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(await StaffUser.countDocuments({ username: 'river' })).toBe(1);
  });

  it.each(['staff', 'admin'])('preserves %s credentials and prevents customer username collisions', async (role) => {
    await StaffUser.create({ username: 'river', role, passwordHash: await bcrypt.hash(registration.password, 4) });
    const collision = await request(app).post('/api/auth/register').send(registration);
    expect(collision.status).toBe(409);
    const login = await request(app).post('/api/auth/login').send(registration);
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ user: { username: 'river', role, name: '', phone: '', email: null }, staff: { username: 'river', role } });
  });

  it('rejects missing, tampered, expired and invalid-role tokens', async () => {
    await seedTables([2]);
    const body = reservationBody({ date: futureDateIso() });
    const missing = await request(app).post('/api/reservations').send(body);
    expect(missing.status).toBe(401);
    const secret = process.env.JWT_SECRET!;
    for (const token of ['fake', jwt.sign({ role: 'customer' }, secret, { subject: 'river', expiresIn: -1 }),
      jwt.sign({ role: 'superuser' }, secret, { subject: 'river' }),
      jwt.sign({ role: 'customer', accountId: '0123456789abcdef01234567' }, secret, { subject: 'river', algorithm: 'HS384' }),
      jwt.sign({ role: 'admin' }, 'a-different-test-signing-secret-value', { subject: 'river' })]) {
      expect((await book(token)).status).toBe(401);
    }
    expect(await Reservation.countDocuments()).toBe(0);
  });

  it('separates customer and staff route gates', async () => {
    const session = await register();
    for (const path of ['/api/staff/reservations?date=' + futureDateIso()]) {
      expect((await request(app).get(path).set('Authorization', `Bearer ${session.token}`)).status).toBe(403);
    }
    expect((await request(app).patch('/api/staff/reservations/RMISSING/status')
      .set('Authorization', `Bearer ${session.token}`).send({ status: 'CANCELLED' })).status).toBe(403);
    expect((await request(app).get('/api/customer/reservations')).status).toBe(401);
  });

  it('derives ownership from the token and lists only own records including past in time order', async () => {
    await seedTables([2, 2, 2]);
    const owner = await register();
    const other = await register('other');
    const later = await book(owner.token, '19:00', { customerId: other.user.id, ownerId: other.user.id });
    const earlier = await book(owner.token, '12:00');
    const foreign = await book(other.token, '18:00');
    expect([later.status, earlier.status, foreign.status]).toEqual([201, 201, 201]);
    await Reservation.updateOne({ reference: earlier.body.reference }, { startTime: new Date('2020-01-01T17:00:00Z') });
    const response = await request(app).get('/api/customer/reservations').set('Authorization', `Bearer ${owner.token}`);
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ timezone: 'America/Toronto', today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(response.body.reservations.map((row: { reference: string }) => row.reference)).toEqual([earlier.body.reference, later.body.reference]);
    expect(response.body.reservations[1]).toMatchObject({ customerEmail: null, customerPhone: expect.any(String), table: { label: expect.any(String), capacity: 2 } });
    expect(JSON.stringify(response.body)).not.toContain(other.user.id);
  });

  it('cancels only own future confirmed bookings, hides foreign references and releases capacity', async () => {
    await seedTables([2]);
    const owner = await register();
    const other = await register('other');
    const created = await book(owner.token);
    expect(created.status).toBe(201);
    const cancel = (token: string, reference: string) => request(app).patch(`/api/customer/reservations/${reference}/cancel`)
      .set('Authorization', `Bearer ${token}`).send({});
    const foreign = await cancel(other.token, created.body.reference as string);
    const missing = await cancel(other.token, 'RMISSING');
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect((await book(other.token)).status).toBe(409);
    const cancelled = await cancel(owner.token, created.body.reference as string);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ reference: created.body.reference, status: 'CANCELLED', customerPhone: expect.any(String) });
    expect((await cancel(owner.token, created.body.reference as string)).status).toBe(409);
    expect((await book(other.token)).status).toBe(201);
  });

  it.each(['past', 'now', 'SEATED', 'COMPLETED', 'NO_SHOW'])('refuses cancellation for %s bookings', async (state) => {
    await seedTables([2]);
    const owner = await register();
    const created = await book(owner.token);
    expect(created.status).toBe(201);
    await Reservation.updateOne({ reference: created.body.reference }, state === 'past' || state === 'now'
      ? { startTime: new Date(Date.now() - (state === 'past' ? 1000 : 0)) } : { status: state });
    const response = await request(app).patch(`/api/customer/reservations/${created.body.reference}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`).send({});
    expect(response.status).toBe(409);
  });

  it('keeps staff-created and historical matching-contact bookings unowned and staff-only', async () => {
    await seedTables([2, 2]);
    const owner = await register('river', 'river@example.com');
    const created = await request(app).post('/api/reservations')
      .set('Authorization', staffAuthorization()).send({
        ...reservationBody({ date: futureDateIso(), customerEmail: 'river@example.com' }),
        customerId: owner.user.id,
      });
    expect(created.status).toBe(201);
    const stored = await Reservation.findOne({ reference: created.body.reference }).lean();
    expect(stored).not.toHaveProperty('customerId');
    if (stored === null) throw new Error('Staff reservation was not stored.');
    await Reservation.create({
      reference: 'RLEGACY', customerName: registration.name, customerPhone: registration.phone,
      customerEmail: 'river@example.com', partySize: 2, tableId: stored.tableId,
      startTime: new Date('2020-01-01T17:00:00Z'), endTime: new Date('2020-01-01T18:30:00Z'),
      status: 'COMPLETED',
    });
    const listed = await request(app).get('/api/customer/reservations').set('Authorization', `Bearer ${owner.token}`);
    expect(listed.body.reservations).toEqual([]);
    const cancelled = await request(app).patch(`/api/customer/reservations/${created.body.reference}/cancel`)
      .set('Authorization', `Bearer ${owner.token}`).send({});
    expect(cancelled.status).toBe(404);
    expect((await request(app).patch('/api/customer/reservations/RLEGACY/cancel')
      .set('Authorization', `Bearer ${owner.token}`).send({})).status).toBe(404);
    const staff = await request(app).get('/api/staff/reservations').query({ date: futureDateIso() })
      .set('Authorization', staffAuthorization());
    expect(staff.body.reservations).toHaveLength(1);
    expect((await request(app).get('/api/customer/reservations').set('Authorization', staffAuthorization())).status).toBe(403);
    expect((await request(app).patch(`/api/customer/reservations/${created.body.reference}/cancel`)
      .set('Authorization', staffAuthorization()).send({})).status).toBe(403);
  });

  it('keeps slot invariants when customer cancellation races staff seating', async () => {
    await seedTables([2]);
    const owner = await register();
    const created = await book(owner.token);
    expect(created.status).toBe(201);
    const responses = await Promise.all([
      request(app).patch(`/api/customer/reservations/${created.body.reference}/cancel`)
        .set('Authorization', `Bearer ${owner.token}`).send({}),
      request(app).patch(`/api/staff/reservations/${created.body.reference}/status`)
        .set('Authorization', staffAuthorization()).send({ status: 'SEATED' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const { assertSlotInvariant } = await import('./helpers.js');
    await assertSlotInvariant();
  });

  it('limits combined login and registration attempts without exposing credentials', async () => {
    const limited = createApp({ authRateLimit: { limit: 2 } });
    const first = await request(limited).post('/api/auth/login').send({ username: 'missing', password: 'incorrect' });
    const second = await request(limited).post('/api/auth/register').send({});
    const third = await request(limited).post('/api/auth/login').send({ username: 'missing', password: 'incorrect' });
    expect(first.status).toBe(401);
    expect(second.status).toBe(400);
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(third.headers['retry-after']).toBeDefined();
  });

});
