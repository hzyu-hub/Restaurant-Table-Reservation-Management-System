import { Router, type RequestHandler } from 'express';
import { asyncHandler } from '../lib/http.js';
import {
  createReservationRateLimiter,
  isRateLimitDisabled,
  type ReservationRateLimitOptions,
} from '../lib/rate-limit.js';
import { parseReservationInput } from '../lib/validation.js';
import { createReservation } from '../services/booking.js';

export interface ReservationsRouterOptions {
  /** Override the rate limiter, or pass `false` to mount no limiter at all. */
  rateLimit?: ReservationRateLimitOptions | false;
}

/**
 * POST /api/reservations
 *
 * Body: { customerName, customerEmail?, customerPhone, partySize, date, time }
 * 201 -> created reservation, 400 -> validation, 409 -> conflict / no table,
 * 429 -> too many attempts from this IP.
 */
export function createReservationsRouter(
  options: ReservationsRouterOptions = {},
): Router {
  const router = Router();

  const createHandler = asyncHandler(async (req, res) => {
    const input = parseReservationInput(req.body);
    const reservation = await createReservation(input);
    res.status(201).json(reservation);
  });

  // An explicit `rateLimit` option always wins over the environment switch, so
  // the rate-limit test can turn the limiter on inside a suite that disables it
  // globally. `false` means "never mount one".
  let limiter: RequestHandler | undefined;
  if (options.rateLimit === false) {
    limiter = undefined;
  } else if (options.rateLimit !== undefined) {
    limiter = createReservationRateLimiter(options.rateLimit);
  } else if (isRateLimitDisabled()) {
    limiter = undefined;
  } else {
    limiter = createReservationRateLimiter();
  }

  // The limiter must sit in front of the handler, so the two cases are kept
  // explicit rather than splicing an array of handlers together.
  if (limiter === undefined) {
    router.post('/', createHandler);
  } else {
    router.post('/', limiter, createHandler);
  }

  return router;
}
