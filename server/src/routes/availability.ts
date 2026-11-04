import { Router } from 'express';
import { ApiError, asyncHandler } from '../lib/http.js';
import { todayInRestaurantTimezone } from '../lib/time.js';
import { parseDate, parsePartySize } from '../lib/validation.js';
import { getAvailability } from '../services/booking.js';

export const availabilityRouter = Router();

/**
 * GET /api/availability?date=YYYY-MM-DD&partySize=N
 *
 * Both parameters are required by the API contract. Every bookable start time
 * is returned (available or not) so the client can render the whole service
 * window rather than a shrinking list.
 */
availabilityRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { date: rawDate, partySize: rawPartySize } = req.query;

    if (typeof rawDate !== 'string') {
      throw ApiError.badRequest(
        'INVALID_DATE',
        'date is required and must be formatted as YYYY-MM-DD.',
      );
    }
    if (rawPartySize === undefined) {
      throw ApiError.badRequest('INVALID_PARTY_SIZE', 'partySize is required.');
    }

    const date = parseDate(rawDate);
    const partySize = parsePartySize(rawPartySize);

    if (date < todayInRestaurantTimezone()) {
      throw ApiError.badRequest(
        'DATE_IN_PAST',
        'Availability cannot be requested for a date in the past.',
      );
    }

    const availability = await getAvailability(date, partySize);
    res.status(200).json(availability);
  }),
);
