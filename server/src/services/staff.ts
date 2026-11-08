/**
 * Staff queries and status changes.
 *
 * Slot rows are released only through `releaseWindow`. This module never
 * imports the `TableSlot` model.
 */
import mongoose from 'mongoose';
import {
  RESERVATION_STATUSES,
  RESTAURANT_TIMEZONE,
  holdsCapacity,
  isTransitionAllowed,
  type ReservationStatus,
} from '../config/booking.js';
import { ApiError } from '../lib/http.js';
import { releaseWindow } from '../lib/slots.js';
import { restaurantLocalDayRange, toIsoString } from '../lib/time.js';
import { parseDate } from '../lib/validation.js';
import { Reservation } from '../models/Reservation.js';
import { Table } from '../models/Table.js';

export interface StaffReservationView {
  reference: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  partySize: number;
  table: {
    label: string;
    capacity: number;
  };
  startTime: string;
  endTime: string;
  status: string;
}

export interface StaffReservationList {
  date: string;
  timezone: string;
  reservations: StaffReservationView[];
}

/** Lists reservations whose start falls on one restaurant-local date. */
export async function listReservationsForDate(rawDate: unknown): Promise<StaffReservationList> {
  const date = parseDate(rawDate);
  const { start: dayStart, end: dayEnd } = restaurantLocalDayRange(date);

  const reservations = await Reservation.find({
    startTime: { $gte: dayStart, $lt: dayEnd },
  })
    .sort({ startTime: 1, reference: 1 })
    .lean();

  const tables = await Table.find({
    _id: { $in: reservations.map((reservation) => reservation.tableId) },
  }).lean();
  const tablesById = new Map(tables.map((table) => [String(table._id), table]));

  return {
    date,
    timezone: RESTAURANT_TIMEZONE,
    reservations: reservations.map((reservation) => {
      const table = tablesById.get(String(reservation.tableId));
      return {
        reference: reservation.reference,
        customerName: reservation.customerName,
        customerEmail: reservation.customerEmail ?? null,
        customerPhone: reservation.customerPhone,
        partySize: reservation.partySize,
        table: {
          label: table?.label ?? 'Unknown',
          capacity: table?.capacity ?? 0,
        },
        startTime: toIsoString(reservation.startTime),
        endTime: toIsoString(reservation.endTime),
        status: reservation.status,
      };
    }),
  };
}

function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

function parseStatusBody(body: unknown): ReservationStatus {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw ApiError.badRequest(
      'INVALID_STATUS',
      'status must be one of CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW.',
    );
  }
  const raw = (body as { status?: unknown }).status;
  if (typeof raw !== 'string' || !isReservationStatus(raw)) {
    throw ApiError.badRequest(
      'INVALID_STATUS',
      'status must be one of CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW.',
    );
  }
  return raw;
}

/**
 * Moves one reservation along `ALLOWED_TRANSITIONS`.
 *
 * Repeating the status the reservation already has is a no-op success, so a
 * retried request cannot fail after the first one landed.
 *
 * Slots are released only when the reservation leaves the blocking set.
 * `CONFIRMED -> SEATED` stays blocking and must keep the table.
 */
export async function changeReservationStatus(
  rawReference: string,
  body: unknown,
): Promise<StaffReservationView> {
  const reference = rawReference.trim();
  if (reference.length === 0) {
    throw ApiError.notFound('No reservation matches that reference.');
  }

  const nextStatus = parseStatusBody(body);
  const reservation = await Reservation.findOne({ reference });
  if (reservation === null) {
    throw ApiError.notFound('No reservation matches that reference.');
  }

  const currentStatus = reservation.status;
  if (!isReservationStatus(currentStatus)) {
    throw new ApiError(500, 'INTERNAL_ERROR', 'Stored reservation status is not recognized.');
  }

  if (currentStatus !== nextStatus) {
    if (!isTransitionAllowed(currentStatus, nextStatus)) {
      throw ApiError.conflict(
        'INVALID_TRANSITION',
        `A ${currentStatus} reservation cannot become ${nextStatus}.`,
      );
    }

    reservation.status = nextStatus;
    await reservation.save();

    if (holdsCapacity(currentStatus) && !holdsCapacity(nextStatus)) {
      const reservationId = reservation._id;
      if (!(reservationId instanceof mongoose.Types.ObjectId)) {
        throw new Error('Reservation is missing its id after save.');
      }
      await releaseWindow(reservationId);
    }
  }

  const table = await Table.findById(reservation.tableId).lean();
  return {
    reference: reservation.reference,
    customerName: reservation.customerName,
    customerEmail: reservation.customerEmail ?? null,
    customerPhone: reservation.customerPhone,
    partySize: reservation.partySize,
    table: {
      label: table?.label ?? 'Unknown',
      capacity: table?.capacity ?? 0,
    },
    startTime: toIsoString(reservation.startTime),
    endTime: toIsoString(reservation.endTime),
    status: reservation.status,
  };
}
