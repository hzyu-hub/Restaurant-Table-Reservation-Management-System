/**
 * Request payload validation. Pure functions: they narrow `unknown` into typed
 * values and throw `ApiError(400)` describing the first problem found.
 *
 * No `any` anywhere — incoming bodies are `unknown` until proven otherwise.
 */
import {
  MAX_PARTY_SIZE,
  MIN_PARTY_SIZE,
} from '../config/booking.js';
import { ApiError } from './http.js';
import { isValidClockTime, isValidIsoDate } from './time.js';

/** A fully validated `POST /api/reservations` payload. */
export interface ReservationInput {
  customerName: string;
  customerEmail: string | undefined;
  customerPhone: string;
  partySize: number;
  /** `YYYY-MM-DD` in restaurant local time. */
  date: string;
  /** `HH:mm` in restaurant local time. */
  time: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NAME_ALLOWED_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M}\s'.,-]*$/u;
const PHONE_ALLOWED_PATTERN = /^\+?[\d\s().-]+$/;
const PHONE_DIGITS_PATTERN = /^\+?\d{10,15}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  source: Record<string, unknown>,
  field: string,
  code: string,
  message: string,
): string {
  const raw = source[field];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw ApiError.badRequest(code, message);
  }
  return raw.trim();
}

/** Validates a party size coming from a JSON body or a query string. */
export function parsePartySize(raw: unknown): number {
  const candidate =
    typeof raw === 'string' && raw.trim().length > 0 ? Number(raw) : raw;

  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw ApiError.badRequest(
      'INVALID_PARTY_SIZE',
      'partySize must be a whole number.',
    );
  }
  if (!Number.isInteger(candidate)) {
    throw ApiError.badRequest(
      'INVALID_PARTY_SIZE',
      'partySize must be a whole number.',
    );
  }
  if (candidate < MIN_PARTY_SIZE || candidate > MAX_PARTY_SIZE) {
    throw ApiError.badRequest(
      'INVALID_PARTY_SIZE',
      `partySize must be between ${MIN_PARTY_SIZE} and ${MAX_PARTY_SIZE}.`,
    );
  }
  return candidate;
}

/** Validates a `YYYY-MM-DD` calendar date from a query string or body. */
export function parseDate(raw: unknown): string {
  if (typeof raw !== 'string' || !isValidIsoDate(raw.trim())) {
    throw ApiError.badRequest(
      'INVALID_DATE',
      'date must be a real calendar date formatted as YYYY-MM-DD.',
    );
  }
  return raw.trim();
}

/** Validates a `HH:mm` local clock time from a body. */
export function parseClockTime(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!isValidClockTime(value)) {
    throw ApiError.badRequest(
      'INVALID_TIME',
      'time must be a 24 hour clock time formatted as HH:mm.',
    );
  }
  return value;
}

function parseCustomerName(raw: unknown): string {
  const name = requireString(
    isRecord(raw) ? raw : {},
    'customerName',
    'INVALID_NAME',
    'customerName is required.',
  );
  if (name.length < 2 || name.length > 80) {
    throw ApiError.badRequest(
      'INVALID_NAME',
      'customerName must be between 2 and 80 characters.',
    );
  }
  if (!NAME_ALLOWED_PATTERN.test(name)) {
    throw ApiError.badRequest(
      'INVALID_NAME',
      'customerName must contain letters and may only include spaces, apostrophes, dots, commas and hyphens.',
    );
  }
  return name;
}

function parseCustomerPhone(raw: unknown): string {
  const phone = requireString(
    isRecord(raw) ? raw : {},
    'customerPhone',
    'INVALID_PHONE',
    'customerPhone is required.',
  );
  if (!PHONE_ALLOWED_PATTERN.test(phone)) {
    throw ApiError.badRequest(
      'INVALID_PHONE',
      'customerPhone may only contain digits, spaces, parentheses, dots, hyphens and an optional leading +.',
    );
  }
  const digits = phone.replace(/[\s().-]/g, '');
  if (!PHONE_DIGITS_PATTERN.test(digits)) {
    throw ApiError.badRequest(
      'INVALID_PHONE',
      'customerPhone must contain between 10 and 15 digits.',
    );
  }
  return phone;
}

function parseOptionalEmail(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string') {
    throw ApiError.badRequest(
      'INVALID_EMAIL',
      'customerEmail must be a valid email address.',
    );
  }
  const email = raw.trim();
  if (email.length === 0) {
    return undefined;
  }
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw ApiError.badRequest(
      'INVALID_EMAIL',
      'customerEmail must be a valid email address.',
    );
  }
  return email.toLowerCase();
}

/** Validates the whole reservation body, or throws a 400 `ApiError`. */
export function parseReservationInput(body: unknown): ReservationInput {
  if (!isRecord(body)) {
    throw ApiError.badRequest(
      'INVALID_BODY',
      'Request body must be a JSON object.',
    );
  }

  const customerName = parseCustomerName(body);
  const customerPhone = parseCustomerPhone(body);
  const customerEmail = parseOptionalEmail(body.customerEmail);
  const partySize = parsePartySize(body.partySize);
  const date = parseDate(body.date);
  const time = parseClockTime(body.time);

  return { customerName, customerEmail, customerPhone, partySize, date, time };
}
