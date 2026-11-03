/**
 * Rate limiting on `POST /api/reservations` (audit 4.5, rec 7).
 *
 * Handling the suite-wide interference: `tests/setup.ts` sets
 * `DISABLE_RATE_LIMIT=1`, because every test file shares one IP (`127.0.0.1`)
 * and one in-memory store, so an always-on limiter would make results depend on
 * test ordering. Here an explicit `rateLimit` option overrides that switch, so
 * the real middleware is exercised deliberately. The first test proves the
 * override actually turns the limiter on, so the suite cannot pass by mounting
 * nothing.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { RESERVATION_RATE_LIMIT, RESERVATION_RATE_WINDOW_MS } from '../src/lib/rate-limit.js';
import { futureDateIso, reservationBody, seedTables } from './helpers.js';

/** Small limit so the test does not need 11 requests to prove the point. */
const TEST_LIMIT = 3;

/**
 * A fresh app per test, so each test gets its own in-memory counter. Sharing
 * one limiter across tests would make the second test start already throttled.
 */
function limitedApp() {
  return createApp({ reservationRateLimit: { limit: TEST_LIMIT } });
}

describe('POST /api/reservations rate limiting', () => {
  it('returns 429 RATE_LIMITED once the limit is exceeded', async () => {
    const app = limitedApp();
    await seedTables([2, 2, 4, 4, 6, 8]);
    const date = futureDateIso();
    const body = reservationBody({ date, time: '18:00', partySize: 1 });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < TEST_LIMIT + 2; attempt += 1) {
      const response = await request(app).post('/api/reservations').send(body);
      statuses.push(response.status);
    }

    // The first TEST_LIMIT requests are handled normally (201 or 409 - the
    // point is that they are not throttled), then the limiter kicks in.
    expect(statuses.slice(0, TEST_LIMIT).every((status) => status < 429)).toBe(true);
    expect(statuses.slice(TEST_LIMIT)).toEqual([429, 429]);
  });

  it('uses the standard error envelope with code RATE_LIMITED', async () => {
    const app = limitedApp();
    await seedTables([2]);
    const date = futureDateIso();
    const body = reservationBody({ date, time: '19:00', partySize: 2 });

    let last = await request(app).post('/api/reservations').send(body);
    for (let attempt = 0; attempt < TEST_LIMIT; attempt += 1) {
      last = await request(app).post('/api/reservations').send(body);
    }

    expect(last.status).toBe(429);
    expect(last.body).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    });
    expect(typeof (last.body as { error: { message: string } }).error.message).toBe(
      'string',
    );
  });

  it('does not throttle GET /api/availability', async () => {
    // The client calls availability on every date change; limiting it would
    // break normal browsing. Same IP, well past the POST limit.
    const app = limitedApp();
    await seedTables([2]);
    const date = futureDateIso();

    // Burn through the POST budget first, then prove the GET is unaffected.
    for (let attempt = 0; attempt < TEST_LIMIT + 2; attempt += 1) {
      await request(app)
        .post('/api/reservations')
        .send(reservationBody({ date, time: '12:00', partySize: 2 }));
    }

    const statuses: number[] = [];
    for (let attempt = 0; attempt < TEST_LIMIT + 5; attempt += 1) {
      const response = await request(app)
        .get('/api/availability')
        .query({ date, partySize: 2 });
      statuses.push(response.status);
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('mounts no limiter at all when the option is false', async () => {
    const unlimitedApp = createApp({ reservationRateLimit: false });
    await seedTables([2]);
    const date = futureDateIso();

    const statuses: number[] = [];
    for (let attempt = 0; attempt < TEST_LIMIT + 2; attempt += 1) {
      const response = await request(unlimitedApp)
        .post('/api/reservations')
        .send(reservationBody({ date, time: '12:00', partySize: 2 }));
      statuses.push(response.status);
    }

    expect(statuses).not.toContain(429);
  });
});

describe('rate limit configuration', () => {
  it('defaults to 10 requests per minute', () => {
    expect(RESERVATION_RATE_LIMIT).toBe(10);
    expect(RESERVATION_RATE_WINDOW_MS).toBe(60_000);
  });
});
