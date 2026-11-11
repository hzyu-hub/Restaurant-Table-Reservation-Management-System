import type { ReservationStatus } from './api.ts';

/** The next statuses a staff member may choose from the current one. */
export const NEXT_STATUSES: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  CONFIRMED: ['SEATED', 'CANCELLED', 'NO_SHOW'],
  SEATED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const STATUS_LABELS: Readonly<Record<ReservationStatus, string>> = {
  CONFIRMED: 'Confirmed',
  SEATED: 'Seat',
  COMPLETED: 'Complete',
  CANCELLED: 'Cancel',
  NO_SHOW: 'No-show',
};

/** Button text for moving a reservation to `status`. */
export function statusActionLabel(status: ReservationStatus): string {
  return STATUS_LABELS[status];
}

/** Readable clock time in the restaurant timezone. */
export function formatRestaurantTime(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(isoInstant));
}
