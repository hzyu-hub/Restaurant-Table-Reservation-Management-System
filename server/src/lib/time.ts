/**
 * Local (restaurant wall clock) <-> UTC instant helpers.
 *
 * Toronto observes DST, so we never do raw offset arithmetic on wall clock
 * values. Instead each wall-clock value is converted through
 * `date-fns-tz.fromZonedTime`, which resolves the correct UTC offset for that
 * specific date. All instants handed to Mongo are UTC `Date` objects.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import {
  BOOKABLE_START_MINUTES,
  OCCUPANCY_PROBE_MINUTES,
  RESTAURANT_TIMEZONE,
  SLOTS_PER_BOOKING,
} from '../config/booking.js';

// `BOOKABLE_START_MINUTES` is the start grid; `OCCUPANCY_PROBE_MINUTES` is the
// 11:00..21:30 grid of every instant a booking can touch.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `minutesFromMidnight` -> `HH:mm`, e.g. 660 -> '11:00'. */
export function minutesToClock(minutesFromMidnight: number): string {
  return `${pad2(Math.floor(minutesFromMidnight / 60))}:${pad2(minutesFromMidnight % 60)}`;
}

/**
 * Strictly validates a `YYYY-MM-DD` string against the real calendar.
 * Uses UTC component comparison so the result never depends on the host zone.
 */
export function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Strictly validates a 24h `HH:mm` string. */
export function isValidClockTime(value: string): boolean {
  return CLOCK_PATTERN.test(value);
}

/** `HH:mm` -> minutes since midnight, or null when malformed. */
export function clockTimeToMinutes(value: string): number | null {
  const match = CLOCK_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Today's calendar date in the restaurant's timezone, as `YYYY-MM-DD`.
 * "Today" must be the restaurant's today, not the server's.
 */
export function todayInRestaurantTimezone(now: Date = new Date()): string {
  return formatInTimeZone(now, RESTAURANT_TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Converts a restaurant-local wall clock value to the matching UTC instant.
 *
 * @param dateIso `YYYY-MM-DD` in restaurant local time
 * @param minutesFromMidnight minutes since local midnight
 */
export function zonedWallClockToUtc(dateIso: string, minutesFromMidnight: number): Date {
  const wallClock = `${dateIso}T${minutesToClock(minutesFromMidnight)}:00`;
  return fromZonedTime(wallClock, RESTAURANT_TIMEZONE);
}

/** Every slot instant a booking can occupy on a local date, ascending. */
export function occupancyProbeInstants(dateIso: string): Date[] {
  return OCCUPANCY_PROBE_MINUTES.map((minutes) =>
    zonedWallClockToUtc(dateIso, minutes),
  );
}

/**
 * The 3 slot instants a booking owns, given the index of its start time within
 * `BOOKABLE_START_MINUTES`. Slicing the day's probe grid keeps DST handling in
 * one place instead of doing minute arithmetic on instants.
 */
export function bookingSlotInstants(dateIso: string, startSlotIndex: number): Date[] {
  const probes = occupancyProbeInstants(dateIso);
  return probes.slice(startSlotIndex, startSlotIndex + SLOTS_PER_BOOKING);
}

/** Index of a clock time within the bookable grid, or -1 when it is not on it. */
export function bookableSlotIndex(minutesFromMidnight: number): number {
  return BOOKABLE_START_MINUTES.indexOf(minutesFromMidnight);
}

/** ISO-8601 representation of an instant, for API responses. */
export function toIsoString(instant: Date): string {
  return instant.toISOString();
}

/** Adds whole minutes to an instant (used for end times that stay in UTC). */
export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

/**
 * UTC bounds for one restaurant-local calendar date: `[start, end)`.
 *
 * The end is the next local date at midnight. Passing `24:00` to the clock
 * converter is invalid, and adding a fixed 24 hours is wrong on a DST boundary.
 */
export function restaurantLocalDayRange(dateIso: string): { start: Date; end: Date } {
  const start = zonedWallClockToUtc(dateIso, 0);
  const [yearText, monthText, dayText] = dateIso.split('-');
  const nextLocalDate = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + 1),
  );
  const nextDateIso = nextLocalDate.toISOString().slice(0, 10);
  return {
    start,
    end: zonedWallClockToUtc(nextDateIso, 0),
  };
}
