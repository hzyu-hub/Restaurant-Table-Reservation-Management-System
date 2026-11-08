/** Staff reservation routes. All of them require a bearer token. */
import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { requireStaff } from '../middleware/staff.js';
import {
  changeReservationStatus,
  listReservationsForDate,
} from '../services/staff.js';

export const staffRouter = Router();

staffRouter.use(requireStaff);

staffRouter.get(
  '/reservations',
  asyncHandler(async (req, res) => {
    const result = await listReservationsForDate(req.query.date);
    res.status(200).json(result);
  }),
);

/** PATCH /api/staff/reservations/:reference/status */
staffRouter.patch(
  '/reservations/:reference/status',
  asyncHandler(async (req, res) => {
    const reference = req.params.reference;
    if (typeof reference !== 'string') {
      throw new Error('Route parameter reference is missing.');
    }
    const updated = await changeReservationStatus(reference, req.body);
    res.status(200).json(updated);
  }),
);
