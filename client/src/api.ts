/**
 * Thin typed client for the reservation API. Every response is validated
 * structurally before use — the network boundary is `unknown`, never `any`.
 */

export interface AvailabilitySlot {
  startTime: string;
  endTime: string;
  available: boolean;
  tablesAvailable: number;
}

export interface AvailabilityResponse {
  date: string;
  partySize: number;
  timezone: string;
  durationMinutes: number;
  slots: AvailabilitySlot[];
}

export interface ReservationRequest {
  customerName: string;
  customerEmail?: string;
  customerPhone: string;
  partySize: number;
  date: string;
  time: string;
}

export interface ReservationResponse {
  reference: string;
  table: { label: string; capacity: number };
  startTime: string;
  endTime: string;
  status: string;
  customerName: string;
  partySize: number;
}

/** An error carrying the API's machine-readable code. */
export class ApiRequestError extends Error {
  public readonly code: string;

  public readonly status: number;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    throw new Error(`Malformed API response: "${key}" is not a string.`);
  }
  return value;
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Malformed API response: "${key}" is not a number.`);
  }
  return value;
}

function parseAvailabilitySlot(value: unknown): AvailabilitySlot {
  if (!isRecord(value)) {
    throw new Error('Malformed API response: slot is not an object.');
  }
  return {
    startTime: readString(value, 'startTime'),
    endTime: readString(value, 'endTime'),
    available: value.available === true,
    tablesAvailable: readNumber(value, 'tablesAvailable'),
  };
}

function parseAvailability(value: unknown): AvailabilityResponse {
  if (!isRecord(value)) {
    throw new Error('Malformed API response: availability is not an object.');
  }
  const rawSlots = value.slots;
  if (!Array.isArray(rawSlots)) {
    throw new Error('Malformed API response: "slots" is not an array.');
  }
  return {
    date: readString(value, 'date'),
    partySize: readNumber(value, 'partySize'),
    timezone: readString(value, 'timezone'),
    durationMinutes: readNumber(value, 'durationMinutes'),
    slots: rawSlots.map(parseAvailabilitySlot),
  };
}

function parseReservation(value: unknown): ReservationResponse {
  if (!isRecord(value)) {
    throw new Error('Malformed API response: reservation is not an object.');
  }
  const rawTable = value.table;
  if (!isRecord(rawTable)) {
    throw new Error('Malformed API response: "table" is not an object.');
  }
  return {
    reference: readString(value, 'reference'),
    table: {
      label: readString(rawTable, 'label'),
      capacity: readNumber(rawTable, 'capacity'),
    },
    startTime: readString(value, 'startTime'),
    endTime: readString(value, 'endTime'),
    status: readString(value, 'status'),
    customerName: readString(value, 'customerName'),
    partySize: readNumber(value, 'partySize'),
  };
}

/** Turns a non-2xx response into an `ApiRequestError` with the API's code. */
async function toApiError(response: Response): Promise<ApiRequestError> {
  let code = 'UNKNOWN_ERROR';
  let message = `Request failed with status ${response.status}.`;

  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && isRecord(payload.error)) {
      const rawCode = payload.error.code;
      const rawMessage = payload.error.message;
      if (typeof rawCode === 'string') {
        code = rawCode;
      }
      if (typeof rawMessage === 'string' && rawMessage.length > 0) {
        message = rawMessage;
      }
    }
  } catch {
    // Body was not JSON; keep the generic message.
  }

  return new ApiRequestError(response.status, code, message);
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiRequestError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Is the API running on port 4000?',
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  return (await response.json()) as unknown;
}

/** `GET /api/availability` for a local date and party size. */
export async function fetchAvailability(
  date: string,
  partySize: number,
): Promise<AvailabilityResponse> {
  const query = new URLSearchParams({
    date,
    partySize: String(partySize),
  });
  const payload = await requestJson(`/api/availability?${query.toString()}`);
  return parseAvailability(payload);
}

/** `POST /api/reservations`. */
export async function createReservation(
  body: ReservationRequest,
): Promise<ReservationResponse> {
  const payload = await requestJson('/api/reservations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseReservation(payload);
}
