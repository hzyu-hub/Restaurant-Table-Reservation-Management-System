import { Router } from 'express';
import { RESTAURANT_TIMEZONE } from '../config/booking.js';
import { asyncHandler } from '../lib/http.js';
import { todayInRestaurantTimezone } from '../lib/time.js';
import { requireCustomer } from '../middleware/account.js';
import { Reservation } from '../models/Reservation.js';
import { changeReservationStatus, reservationViews } from '../services/staff.js';

export const customerRouter = Router();
customerRouter.use(requireCustomer);

customerRouter.get('/reservations', asyncHandler(async (req, res) => {
  if (req.account === undefined) throw new Error('Customer guard did not set an account.');
  const reservations = await Reservation.find({ customerId: req.account.id })
    .sort({ startTime: 1, reference: 1 }).lean();
  res.status(200).json({
    timezone: RESTAURANT_TIMEZONE,
    today: todayInRestaurantTimezone(),
    reservations: await reservationViews(reservations),
  });
}));

customerRouter.patch('/reservations/:reference/cancel', asyncHandler(async (req, res) => {
  if (req.account === undefined || typeof req.params.reference !== 'string') {
    throw new Error('Customer guard or route parameter is missing.');
  }
  const reservation = await changeReservationStatus(req.params.reference, { status: 'CANCELLED' }, req.account.id);
  res.status(200).json(reservation);
}));
