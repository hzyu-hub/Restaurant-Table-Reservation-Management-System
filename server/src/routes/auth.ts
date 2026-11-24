/** Account login and customer registration share an IP-based attempt budget. */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginStaff, registerCustomer } from '../lib/auth.js';
import { asyncHandler, errorPayload } from '../lib/http.js';
import { isRateLimitDisabled, type ReservationRateLimitOptions } from '../lib/rate-limit.js';

export function createAuthRouter(options?: ReservationRateLimitOptions | false): Router {
  const router = Router();
  if (options !== false && (options !== undefined || !isRateLimitDisabled())) {
    router.use(rateLimit({
      windowMs: options?.windowMs ?? 15 * 60_000,
      limit: options?.limit ?? 20,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res) => {
        res.status(429).json(errorPayload('RATE_LIMITED', 'Too many sign-in attempts. Please wait and try again.'));
      },
    }));
  }

  router.post('/login', asyncHandler(async (req, res) => {
    res.status(200).json(await loginStaff(req.body));
  }));
  router.post('/register', asyncHandler(async (req, res) => {
    res.status(201).json(await registerCustomer(req.body));
  }));
  return router;
}
