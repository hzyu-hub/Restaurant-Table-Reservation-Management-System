/**
 * Single source of truth for the restaurant's booking rules.
 *
 * Everything here is expressed in *restaurant local time* (wall-clock minutes
 * since midnight). Conversion to UTC instants happens in `src/lib/time.ts`.
 */

/** The restaurant operates in Toronto, so all wall-clock rules use this zone. */
export const RESTAURANT_TIMEZONE = 'America/Toronto';

/** Service opens at 11:00 local. */
export const SERVICE_OPEN_MINUTES = 11 * 60;

/** Service closes at 22:00 local. */
export const SERVICE_CLOSE_MINUTES = 22 * 60;

/** Every booking lasts 90 minutes. */
export const BOOKING_DURATION_MINUTES = 90;

/** Bookings may only start on a 30 minute grid. */
export const SLOT_INCREMENT_MINUTES = 30;

/** A 90 minute booking occupies 3 consecutive 30 minute slots. */
export const SLOTS_PER_BOOKING = BOOKING_DURATION_MINUTES / SLOT_INCREMENT_MINUTES;

/**
 * Last bookable start is 20:30 local, because 20:30 + 90 minutes == 22:00 close.
 */
export const LAST_BOOKABLE_START_MINUTES = SERVICE_CLOSE_MINUTES - BOOKING_DURATION_MINUTES;

/** Minimum party size accepted by the API. */
export const MIN_PARTY_SIZE = 1;

/** Maximum party size accepted by the API. */
export const MAX_PARTY_SIZE = 20;

/**
 * Upper bound on how many candidate tables `createReservation` will attempt
 * before returning a conflict.
 *
 * Each attempt writes 3 slot rows, and an attempt only fails when another
 * request already holds that table's window — so the number of attempts needed
 * is at most the number of tables that fit the party. This bound therefore has
 * to comfortably exceed the restaurant's table count: with the six seeded
 * tables, a cap of 5 made the largest table unbookable whenever every smaller
 * one was taken. It stays a real safety valve, just not a reachable one in
 * normal operation.
 */
export const MAX_CANDIDATE_ATTEMPTS = 25;

/**
 * All 20 bookable start times for a day, as minutes since local midnight:
 * 11:00, 11:30, ... 20:30.
 */
export const BOOKABLE_START_MINUTES: readonly number[] = Array.from(
  {
    length:
      (LAST_BOOKABLE_START_MINUTES - SERVICE_OPEN_MINUTES) / SLOT_INCREMENT_MINUTES + 1,
  },
  (_unused, index) => SERVICE_OPEN_MINUTES + index * SLOT_INCREMENT_MINUTES,
);

/**
 * Every 30 minute slot instant a booking can touch, as minutes since local
 * midnight: 11:00 ... 21:30. This is one booking-length longer than the
 * bookable start grid, because the last booking runs 20:30 -> 22:00.
 */
export const OCCUPANCY_PROBE_MINUTES: readonly number[] = Array.from(
  {
    length:
      (LAST_BOOKABLE_START_MINUTES + BOOKING_DURATION_MINUTES - SERVICE_OPEN_MINUTES) /
        SLOT_INCREMENT_MINUTES +
      1,
  },
  (_unused, index) => SERVICE_OPEN_MINUTES + index * SLOT_INCREMENT_MINUTES,
);

/** Every reservation status the system understands. */
export const RESERVATION_STATUSES = [
  'CONFIRMED',
  'SEATED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/**
 * Only these statuses hold table capacity. A slot row exists in `tableSlots`
 * if and only if the owning reservation is in a blocking status, so cancelling
 * (or completing) a reservation must delete its slot rows.
 *
 * This is the single source of truth for "does this status hold a table".
 * Never re-enumerate the blocking statuses anywhere else; call
 * `holdsCapacity()` instead.
 */
export const BLOCKING_STATUSES: readonly ReservationStatus[] = ['CONFIRMED', 'SEATED'];

/**
 * The legal status transitions (US4: "invalid transitions are rejected").
 *
 * Data, not code: Sprint 3's `PATCH /api/staff/reservations/:id/status` handler
 * validates against this table rather than re-deriving the rules, so the
 * endpoint and the tests cannot drift apart.
 *
 * Rules:
 * - CONFIRMED is the only status a new booking starts in.
 * - CONFIRMED may be seated, cancelled, or marked no-show.
 * - SEATED may only be completed (a seated party cannot be "cancelled").
 * - COMPLETED, CANCELLED and NO_SHOW are terminal: no transition leaves them.
 *
 * Every edge out of a blocking status lands in a non-blocking status, which is
 * what makes "release the slot rows on transition" correct. A test asserts that
 * property over the whole matrix.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<ReservationStatus, readonly ReservationStatus[]>
> = {
  CONFIRMED: ['SEATED', 'CANCELLED', 'NO_SHOW'],
  SEATED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/** True when `to` is a legal next status for `from`. */
export function isTransitionAllowed(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * True when a reservation in `status` occupies its table.
 *
 * Reads `BLOCKING_STATUSES` rather than re-listing statuses, so adding or
 * removing a blocking status is a one-line change in one place.
 */
export function holdsCapacity(status: ReservationStatus): boolean {
  return BLOCKING_STATUSES.includes(status);
}
