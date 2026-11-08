/**
 * Read-only staff queries.
 *
 * Status changes belong to Sprint 3b. This module never touches slot rows.
 */
import { RESTAURANT_TIMEZONE } from '../config/booking.js';
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
