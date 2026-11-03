/**
 * Privacy and client-fault mapping in the central error handler
 * (audit 2.2, 2.3, rec 5).
 *
 * The defect being locked down: `console.error('[api] unhandled error:', error)`
 * passed the whole error object, and a body-parser failure carries the raw
 * request body on `error.body`. A malformed booking therefore wrote the
 * customer's name, phone and email into the log verbatim, which the PRD
 * Privacy NFR forbids. Malformed JSON also returned 500 instead of 400.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { futureDateIso, seedTables } from './helpers.js';

const app = createApp();

/** Values that must never appear in a log line. */
const SECRET_NAME = 'Zelda Quarantine-Pemberton';
const SECRET_PHONE = '4165550199';
const SECRET_EMAIL = 'zelda.pemberton@example.com';

/** Captures everything written to `console.error` during a test. */
function captureErrorLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(
      args
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' '),
    );
  });

  return {
    lines,
    restore: () => {
      spy.mockRestore();
    },
  };
}

describe('malformed JSON body', () => {
  let capture: ReturnType<typeof captureErrorLog>;

  beforeEach(() => {
    capture = captureErrorLog();
  });

  afterEach(() => {
    capture.restore();
  });

  it('returns 400 INVALID_JSON and never logs the customer data', async () => {
    await seedTables([4]);

    // A recognisable booking body, truncated so JSON.parse fails. Every value
    // below is valid input - only the syntax is broken.
    const malformed = [
      '{',
      `  "customerName": "${SECRET_NAME}",`,
      `  "customerPhone": "${SECRET_PHONE}",`,
      `  "customerEmail": "${SECRET_EMAIL}",`,
      '  "partySize": 2,',
      `  "date": "${futureDateIso()}",`,
      '  "time": "18:00"',
      // deliberately missing the closing brace
    ].join('\n');

    const response = await request(app)
      .post('/api/reservations')
      .set('Content-Type', 'application/json')
      .send(malformed);

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'INVALID_JSON' } });
    expect(typeof (response.body as { error: { message: string } }).error.message).toBe(
      'string',
    );

    // The whole point: nothing customer-identifying reached the log.
    const logged = capture.lines.join('\n');
    expect(logged).not.toContain(SECRET_NAME);
    expect(logged).not.toContain(SECRET_PHONE);
    expect(logged).not.toContain(SECRET_EMAIL);
    expect(logged).not.toContain('zelda');
    // And it did not smuggle the body in under another key either.
    expect(logged).not.toContain('customerName');
    expect(logged).not.toContain('customerPhone');
    expect(logged).not.toContain('customerEmail');

    // This path is a client fault, so it is not logged as an unhandled error.
    expect(logged).not.toContain('[api] unhandled error');
  });

  it('does not leak the body through the response either', async () => {
    await seedTables([4]);

    const malformed = `{"customerName": "${SECRET_NAME}", "customerPhone": "${SECRET_PHONE}"`;
    const response = await request(app)
      .post('/api/reservations')
      .set('Content-Type', 'application/json')
      .send(malformed);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain(SECRET_NAME);
    expect(serialized).not.toContain(SECRET_PHONE);
  });
});

describe('oversized body', () => {
  it('returns 413 PAYLOAD_TOO_LARGE with the standard envelope', async () => {
    await seedTables([4]);

    // Over the 64kb `express.json` limit.
    const huge = JSON.stringify({
      customerName: 'A'.repeat(80_000),
      customerPhone: '4165550100',
      partySize: 2,
      date: futureDateIso(),
      time: '18:00',
    });

    const capture = captureErrorLog();
    try {
      const response = await request(app)
        .post('/api/reservations')
        .set('Content-Type', 'application/json')
        .send(huge);

      expect(response.status).toBe(413);
      expect(response.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
      // Client fault: not an unhandled error, so nothing is logged as one.
      expect(capture.lines.join('\n')).not.toContain('[api] unhandled error');
    } finally {
      capture.restore();
    }
  });
});

describe('unhandled errors', () => {
  it('logs safe scalars only, never the error object', async () => {
    const { summarizeErrorForLog } = await import('../src/app.js');

    // A realistic body-parser failure: it carries `body` with customer data.
    const bodyParserError = Object.assign(new SyntaxError('Unexpected token }'), {
      status: 400,
      type: 'entity.parse.failed',
      body: `{"customerName":"${SECRET_NAME}","customerPhone":"${SECRET_PHONE}"}`,
      headers: { authorization: 'Bearer should-never-be-logged' },
    });

    const summary = summarizeErrorForLog(bodyParserError);
    const serialized = JSON.stringify(summary);

    expect(summary.name).toBe('SyntaxError');
    expect(summary.status).toBe(400);
    expect(summary.type).toBe('entity.parse.failed');
    expect(serialized).not.toContain(SECRET_NAME);
    expect(serialized).not.toContain(SECRET_PHONE);
    expect(serialized).not.toContain('should-never-be-logged');
    expect(Object.keys(summary).sort()).toEqual(
      ['message', 'name', 'status', 'type'].sort(),
    );
  });

  it('truncates a long message instead of dumping it', async () => {
    const { summarizeErrorForLog } = await import('../src/app.js');

    const summary = summarizeErrorForLog(new Error('x'.repeat(5_000)));
    expect(summary.message.length).toBeLessThanOrEqual(200);
  });

  it('handles a non-object thrown value without crashing', async () => {
    const { summarizeErrorForLog } = await import('../src/app.js');

    expect(() => summarizeErrorForLog('boom')).not.toThrow();
    expect(() => summarizeErrorForLog(undefined)).not.toThrow();
  });
});
