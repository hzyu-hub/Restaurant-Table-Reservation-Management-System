/**
 * Test helpers. `futureDateIso` picks a date a few weeks ahead in the
 * restaurant's timezone, which is always inside service hours for a `T12:00`
 * style request and avoids DST edge days.
 */
import { addDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { RESTAURANT_TIMEZONE } from '../src/config/booking.js';
import { Table } from '../src/models/Table.js';

/** A local calendar date `offsetDays` from now, as `YYYY-MM-DD`. */
export function futureDateIso(offsetDays = 14): string {
  const target = addDays(new Date(), offsetDays);
  return formatInTimeZone(target, RESTAURANT_TIMEZONE, 'yyyy-MM-dd');
}

/** A local calendar date in the past, as `YYYY-MM-DD`. */
export function pastDateIso(offsetDays = 7): string {
  const target = addDays(new Date(), -offsetDays);
  return formatInTimeZone(target, RESTAURANT_TIMEZONE, 'yyyy-MM-dd');
}

/** Creates tables from a capacity list, labelled T1..Tn. */
export async function seedTables(capacities: number[]): Promise<
  { _id: unknown; label: string; capacity: number }[]
> {
  const documents = capacities.map((capacity, index) => ({
    label: `T${index + 1}`,
    capacity,
    active: true,
  }));

  await Table.insertMany(documents);
  const created = await Table.find().sort({ label: 1 }).lean();
  return created.map((table) => ({
    _id: table._id,
    label: table.label,
    capacity: table.capacity,
  }));
}

/** A valid reservation body for the given date/time/party size. */
export function reservationBody(overrides: {
  date: string;
  time?: string;
  partySize?: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    customerName: overrides.customerName ?? 'Ada Lovelace',
    customerPhone: overrides.customerPhone ?? '416-555-0142',
    partySize: overrides.partySize ?? 2,
    date: overrides.date,
    time: overrides.time ?? '18:00',
  };

  if (overrides.customerEmail !== undefined) {
    body.customerEmail = overrides.customerEmail;
  }

  return body;
}
