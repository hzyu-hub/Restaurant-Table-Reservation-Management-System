/** GET /api/staff/reservations?date=YYYY-MM-DD */
import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireStaff } from '../middleware/staff.js';
import { listReservationsForDate } from '../services/staff.js';

export const staffRouter = Router();

staffRouter.get(
  '/reservations',
  requireStaff,
  asyncHandler(async (req, res) => {
    const result = await listReservationsForDate(req.query.date);
    res.status(200).json(result);
  }),
);
