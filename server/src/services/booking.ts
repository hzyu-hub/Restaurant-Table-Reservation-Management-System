/**
 * Booking domain service.
 *
 * Availability reads are plain queries. Writes use the FR4 concurrency guard:
 * 3 `tableSlots` rows per booking, protected by the unique `{tableId, slotStart}`
 * index. We never do "check then insert" — we insert and let the unique index
 * arbitrate, then repair whatever the insert left behind.
 */
import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import {
  BOOKABLE_START_MINUTES,
  BOOKING_DURATION_MINUTES,
  LAST_BOOKABLE_START_MINUTES,
  MAX_CANDIDATE_ATTEMPTS,
  RESTAURANT_TIMEZONE,
  SLOTS_PER_BOOKING,
  SERVICE_OPEN_MINUTES,
} from '../config/booking.js';
import { ApiError } from '../lib/http.js';
import type { ReservationInput } from '../lib/validation.js';
import {
  addMinutes,
  bookableSlotIndex,
  bookingSlotInstants,
  clockTimeToMinutes,
  occupancyProbeInstants,
  toIsoString,
  zonedWallClockToUtc,
} from '../lib/time.js';
import { Reservation } from '../models/Reservation.js';
import { Table } from '../models/Table.js';
import { TableSlot } from '../models/TableSlot.js';

/** One bookable start time on a given day, as returned by the availability API. */
export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
  tablesAvailable: number;
}

/** Full availability payload for one date + party size. */
export interface AvailabilityResult {
  date: string;
  partySize: number;
  timezone: string;
  durationMinutes: number;
  slots: AvailabilitySlot[];
}

/** The public shape of a newly created reservation. */
export interface CreatedReservation {
  reference: string;
  table: { label: string; capacity: number };
  startTime: string;
  endTime: string;
  status: string;
  customerName: string;
  partySize: number;
}

/** Reference alphabet without look-alike characters (no 0/O, 1/I). */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const REFERENCE_LENGTH = 8;

/** Human-readable, collision-resistant booking reference, e.g. `R7K4M9QX`. */
function generateReference(): string {
  const bytes = randomBytes(REFERENCE_LENGTH);
  let reference = 'R';
  for (let index = 0; index < REFERENCE_LENGTH - 1; index += 1) {
    reference += REFERENCE_ALPHABET[bytes[index] % REFERENCE_ALPHABET.length];
  }
  return reference;
}

/** Tells a unique-index violation apart from any other write failure. */
function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; writeErrors?: unknown };

  if (candidate.code === 11000) {
    return true;
  }

  if (Array.isArray(candidate.writeErrors)) {
    return candidate.writeErrors.some((writeError: unknown) => {
      if (typeof writeError !== 'object' || writeError === null) {
        return false;
      }
      const { code } = writeError as { code?: unknown };
      return code === 11000;
    });
  }

  return false;
}

/** Resolves `{ date, time }` to the UTC booking window, or throws a 400. */
function resolveRequestedWindow(date: string, time: string): {
  startTime: Date;
  endTime: Date;
  slotIndex: number;
} {
  const startMinutes = clockTimeToMinutes(time);
  if (startMinutes === null) {
    throw ApiError.badRequest(
      'INVALID_TIME',
      'time must be a 24 hour clock time formatted as HH:mm.',
    );
  }

  if (startMinutes < SERVICE_OPEN_MINUTES || startMinutes > LAST_BOOKABLE_START_MINUTES) {
    throw ApiError.badRequest(
      'OUTSIDE_SERVICE_HOURS',
      `Bookings are accepted from 11:00 until 20:30 (the restaurant closes at 22:00).`,
    );
  }

  const slotIndex = bookableSlotIndex(startMinutes);
  if (slotIndex < 0) {
    throw ApiError.badRequest(
      'INVALID_TIME',
      'time must sit on a 30 minute boundary, for example 18:00 or 18:30.',
    );
  }

  const startTime = zonedWallClockToUtc(date, startMinutes);
  if (startTime.getTime() <= Date.now()) {
    throw ApiError.badRequest(
      'RESERVATION_IN_PAST',
      'Reservations cannot be made for a start time in the past.',
    );
  }

  return {
    startTime,
    endTime: addMinutes(startTime, BOOKING_DURATION_MINUTES),
    slotIndex,
  };
}

/**
 * Availability for every bookable start time on a local date.
 *
 * Unavailable slots are returned with `available: false` rather than omitted,
 * so the client can render the whole service window.
 */
export async function getAvailability(
  date: string,
  partySize: number,
): Promise<AvailabilityResult> {
  const candidates = await Table.find({
    active: true,
    capacity: { $gte: partySize },
  })
    .sort({ capacity: 1, label: 1 })
    .lean();

  const candidateIds = candidates.map((table) => table._id);
  const probeInstants = occupancyProbeInstants(date);

  // Every slot row that could block any booking of this day sits inside the
  // 11:00..21:30 probe grid.
  const occupiedByTable = new Map<string, Set<number>>();
  if (candidateIds.length > 0) {
    const occupiedRows = await TableSlot.find({
      tableId: { $in: candidateIds },
      slotStart: { $gte: probeInstants[0], $lte: probeInstants[probeInstants.length - 1] },
    })
      .select({ tableId: 1, slotStart: 1 })
      .lean();

    for (const row of occupiedRows) {
      const key = String(row.tableId);
      const instants = occupiedByTable.get(key) ?? new Set<number>();
      instants.add(row.slotStart.getTime());
      occupiedByTable.set(key, instants);
    }
  }

  const now = Date.now();
  const slots = BOOKABLE_START_MINUTES.map((startMinutes, slotIndex) => {
    const windowInstants = probeInstants.slice(
      slotIndex,
      slotIndex + SLOTS_PER_BOOKING,
    );
    const startTime = zonedWallClockToUtc(date, startMinutes);
    const endTime = addMinutes(startTime, BOOKING_DURATION_MINUTES);
    const isPast = startTime.getTime() <= now;

    const tablesAvailable = isPast
      ? 0
      : candidates.reduce((count, table) => {
          const occupied = occupiedByTable.get(String(table._id));
          if (occupied === undefined) {
            return count + 1;
          }
          const blocked = windowInstants.some((instant) =>
            occupied.has(instant.getTime()),
          );
          return blocked ? count : count + 1;
        }, 0);

    return {
      startTime: toIsoString(startTime),
      endTime: toIsoString(endTime),
      available: tablesAvailable > 0,
      tablesAvailable,
    } satisfies AvailabilitySlot;
  });

  return {
    date,
    partySize,
    timezone: RESTAURANT_TIMEZONE,
    durationMinutes: BOOKING_DURATION_MINUTES,
    slots,
  };
}

/**
 * Creates a reservation, or throws:
 * - 400 `ApiError` for invalid input / past start / off-grid start
 * - 409 `NO_TABLE_AVAILABLE` when no table fits the party
 * - 409 `BOOKING_CONFLICT` when the requested window is already taken
 *
 * Algorithm (FR4):
 * 1. Resolve the local wall clock request to a UTC window (400 on bad input).
 * 2. Pick candidate tables, smallest sufficient capacity first (best fit).
 * 3. Generate the reservation id up front so slot rows can be cleaned up.
 * 4. `insertMany` the 3 slot rows with `{ ordered: false }` — the unique
 *    `{tableId, slotStart}` index rejects the losing racer. On a duplicate key
 *    we delete this attempt's partial rows and fall through to the next table.
 * 5. Only once the slots are secured is the Reservation document written. If
 *    that write fails, the slot rows are removed again so no table is left
 *    falsely blocked.
 */
export async function createReservation(
  input: ReservationInput,
): Promise<CreatedReservation> {
  const { startTime, endTime, slotIndex } = resolveRequestedWindow(
    input.date,
    input.time,
  );

  const slotInstants = bookingSlotInstants(input.date, slotIndex);
  if (slotInstants.length !== SLOTS_PER_BOOKING) {
    throw new Error(
      `Expected ${SLOTS_PER_BOOKING} slot instants, received ${slotInstants.length}.`,
    );
  }

  const candidates = await Table.find({
    active: true,
    capacity: { $gte: input.partySize },
  })
    .sort({ capacity: 1, label: 1 })
    .lean();

  if (candidates.length === 0) {
    throw ApiError.conflict(
      'NO_TABLE_AVAILABLE',
      'No table can seat that party size. Please call the restaurant.',
    );
  }

  const reservationId = new mongoose.Types.ObjectId();
  let attempts = 0;

  for (const table of candidates) {
    if (attempts >= MAX_CANDIDATE_ATTEMPTS) {
      break;
    }
    attempts += 1;

    const slotRows = slotInstants.map((slotStart) => ({
      tableId: table._id,
      slotStart,
      reservationId,
    }));

    try {
      // `ordered: false` keeps going after the first duplicate, so a rejected
      // attempt may already own some of the 3 rows. The cleanup below is
      // mandatory, not defensive.
      await TableSlot.insertMany(slotRows, { ordered: false });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        await TableSlot.deleteMany({ reservationId });
        throw error;
      }

      await TableSlot.deleteMany({ reservationId });
      continue;
    }

    try {
      const reservation = await Reservation.create({
        _id: reservationId,
        reference: generateReference(),
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone,
        partySize: input.partySize,
        tableId: table._id,
        startTime,
        endTime,
        status: 'CONFIRMED',
      });

      return {
        reference: reservation.reference,
        table: { label: table.label, capacity: table.capacity },
        startTime: toIsoString(reservation.startTime),
        endTime: toIsoString(reservation.endTime),
        status: reservation.status,
        customerName: reservation.customerName,
        partySize: reservation.partySize,
      };
    } catch (error) {
      // Slots are already secured but the reservation failed: release them.
      await TableSlot.deleteMany({ reservationId });
      throw error;
    }
  }

  throw ApiError.conflict(
    'BOOKING_CONFLICT',
    'That time slot was just taken. Please choose another time.',
  );
}
