/**
 * Performance smoke test (audit rec 12).
 *
 * The PRD's Performance NFR says the API responds within 2 seconds with demo
 * data, and the plan was silent on it. This measures `GET /api/availability`
 * against realistic seeded data and asserts a budget.
 *
 * Two numbers are reported:
 * - the MEDIAN of the measured calls, asserted against the PRD's 2 s target;
 * - the slowest single call, asserted against a looser ceiling.
 *
 * Why median-and-not-max against 2 s: the first call after connecting pays
 * one-time costs (connection warm-up, Mongo plan cache, V8 warm-up) that a
 * laptop CI runner makes wildly variable. Asserting the max against 2 s would
 * be a flake generator, and a flaky performance test gets deleted rather than
 * fixed. The median is the honest steady-state number, and the per-call ceiling
 * below still catches an order-of-magnitude regression.
 *
 * `console.log` prints the measured numbers so `npm test` output carries the
 * evidence, not just a green tick.
 */
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Table } from '../src/models/Table.js';
import { futureDateIso, reservationBody } from './helpers.js';

const app = createApp();

/** The PRD's stated target for an API response. */
const PRD_TARGET_MS = 2_000;

/** Hard ceiling for any single call, generous enough for a cold laptop. */
const SINGLE_CALL_CEILING_MS = 5_000;

/** Number of measured calls; the first is warm-up and is discarded. */
const MEASURED_CALLS = 10;

/** A realistic full restaurant: 20 tables, 84 seats. */
const REALISTIC_TABLES: readonly number[] = [
  2, 2, 2, 2, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4, 6, 6, 6, 8, 8, 10,
];

/** Median of a non-empty numeric array. */
function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

describe('GET /api/availability performance', () => {
  it('responds within the PRD 2 second target on realistic data', async () => {
    // Seed the tables directly: `seedTables` labels them T1..Tn, which is fine
    // here because this test only reads.
    await Table.insertMany(
      REALISTIC_TABLES.map((capacity, index) => ({
        label: `P${String(index + 1).padStart(2, '0')}`,
        capacity,
        active: true,
      })),
    );

    const date = futureDateIso();

    // Put real load on the collection: 40 bookings spread over the day, so the
    // availability query has to scan actual slot rows rather than an empty set.
    const times = ['11:00', '12:00', '13:00', '18:00', '19:00', '20:00'];
    let bookings = 0;
    for (const time of times) {
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await request(app)
          .post('/api/reservations')
          .send(reservationBody({ date, time, partySize: 2 }));
        if (response.status === 201) {
          bookings += 1;
        }
      }
    }
    expect(bookings).toBeGreaterThan(20);

    const slotRowCount = await request(app)
      .get('/api/availability')
      .query({ date, partySize: 2 });
    expect(slotRowCount.status).toBe(200);

    // Warm-up call: discarded from the measurement.
    const warmUp = await request(app)
      .get('/api/availability')
      .query({ date, partySize: 2 });
    expect(warmUp.status).toBe(200);

    const samples: number[] = [];
    for (let call = 0; call < MEASURED_CALLS; call += 1) {
      const startedAt = performance.now();
      const response = await request(app)
        .get('/api/availability')
        .query({ date, partySize: 2 });
      const elapsed = performance.now() - startedAt;

      expect(response.status).toBe(200);
      samples.push(elapsed);
    }

    const medianMs = median(samples);
    const slowestMs = Math.max(...samples);

    console.log(
      `[perf] GET /api/availability over ${MEASURED_CALLS} calls, ` +
        `${REALISTIC_TABLES.length} tables, ${bookings} bookings: ` +
        `median ${medianMs.toFixed(1)} ms, slowest ${slowestMs.toFixed(1)} ms ` +
        `(PRD target ${PRD_TARGET_MS} ms)`,
    );

    expect(medianMs).toBeLessThan(PRD_TARGET_MS);
    expect(slowestMs).toBeLessThan(SINGLE_CALL_CEILING_MS);
  });
});
