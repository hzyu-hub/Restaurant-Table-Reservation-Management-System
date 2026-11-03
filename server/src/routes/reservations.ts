import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { parseReservationInput } from '../lib/validation.js';
import { createReservation } from '../services/booking.js';

export const reservationsRouter = Router();

/**
 * POST /api/reservations
 *
 * Body: { customerName, customerEmail?, customerPhone, partySize, date, time }
 * 201 -> created reservation, 400 -> validation, 409 -> conflict / no table.
 */
reservationsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseReservationInput(req.body);
    const reservation = await createReservation(input);
    res.status(201).json(reservation);
  }),
);
