/**
 * Rate limiting for the public booking endpoint (audit 4.5, rec 7).
 *
 * Scope is deliberately narrow: `POST /api/reservations` only. The availability
 * GET is read-only and the client re-fetches it on every date or party-size
 * change, so throttling it would break normal use for a customer clicking
 * through dates. The booking POST is the one that writes, and the one worth
 * throttling.
 *
 * What this does and does not buy (see docs/IMPLEMENTATION_PLAN.md section 8):
 * it caps request volume per IP. It does NOT stop inventory squatting - an
 * attacker inside the limit can still book every table for a day, and only
 * Sprint 3 staff tooling can release those bookings. That is a separately
 * accepted risk, not something throttling solves.
 */
import rateLimit from 'express-rate-limit';
import { errorPayload } from './http.js';

/** Requests allowed per IP per window on `POST /api/reservations`. */
export const RESERVATION_RATE_LIMIT = 10;

/** Window length for `RESERVATION_RATE_LIMIT`, in milliseconds. */
export const RESERVATION_RATE_WINDOW_MS = 60_000;

/**
 * The limiter is disabled under test by default.
 *
 * Why: the counter is per-process and per-IP, and the whole suite runs from
 * `127.0.0.1`. A limiter active by default would make the booking tests fail
 * once the suite as a whole crossed ten POSTs, in a way that depends on test
 * ordering - a flaky suite is worse than no limiter coverage. Instead,
 * `tests/rate-limit.test.ts` builds its own app with a limiter configured for
 * that test (`createApp({ reservationRateLimit: { limit: 3 } })`), so the real
 * middleware is exercised on purpose rather than by accident.
 */
export const RATE_LIMIT_DISABLED_ENV = 'DISABLE_RATE_LIMIT';

/** True when rate limiting should be skipped for this process. */
export function isRateLimitDisabled(): boolean {
  const value = process.env[RATE_LIMIT_DISABLED_ENV];
  return value === '1' || value === 'true';
}

export interface ReservationRateLimitOptions {
  /** Maximum requests per IP per window. Defaults to `RESERVATION_RATE_LIMIT`. */
  limit?: number;
  /** Window length in milliseconds. Defaults to `RESERVATION_RATE_WINDOW_MS`. */
  windowMs?: number;
}

/**
 * Builds the `POST /api/reservations` limiter.
 *
 * The 429 uses the same `{ error: { code, message } }` envelope as every other
 * error, with code `RATE_LIMITED`, so the client needs no special case.
 */
export function createReservationRateLimiter(
  options: ReservationRateLimitOptions = {},
): ReturnType<typeof rateLimit> {
  return rateLimit({
    windowMs: options.windowMs ?? RESERVATION_RATE_WINDOW_MS,
    limit: options.limit ?? RESERVATION_RATE_LIMIT,
    // `draft-7` sends the standard `RateLimit-*` headers and no legacy
    // `X-RateLimit-*` ones; the client does not read either.
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res
        .status(429)
        .json(
          errorPayload(
            'RATE_LIMITED',
            'Too many booking attempts. Please wait a minute and try again.',
          ),
        );
    },
  });
}
