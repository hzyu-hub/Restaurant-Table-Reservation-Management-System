import cors from 'cors';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { RESTAURANT_TIMEZONE } from './config/booking.js';
import { ApiError, errorPayload, isApiError } from './lib/http.js';
import { todayInRestaurantTimezone } from './lib/time.js';
import { availabilityRouter } from './routes/availability.js';
import {
  createReservationsRouter,
  type ReservationsRouterOptions,
} from './routes/reservations.js';

/** Longest `message` we will put in a log line. */
const MAX_LOGGED_MESSAGE_LENGTH = 200;

/**
 * Safe, log-only view of an error.
 *
 * NEVER include the error object itself, `error.body`, `req.body` or request
 * headers here. A body-parser failure carries the raw request body on
 * `error.body`, which for a booking contains the customer's name, phone and
 * email - the Privacy NFR forbids putting those in logs. Scalars only.
 */
interface SafeErrorSummary {
  name: string;
  message: string;
  status?: number;
  type?: string;
  code?: string | number;
}

function summarizeErrorForLog(error: unknown): SafeErrorSummary {
  if (typeof error !== 'object' || error === null) {
    return { name: typeof error, message: 'non-object error' };
  }

  const source = error as {
    name?: unknown;
    message?: unknown;
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
    code?: unknown;
  };

  const message =
    typeof source.message === 'string'
      ? source.message.slice(0, MAX_LOGGED_MESSAGE_LENGTH)
      : '';

  const summary: SafeErrorSummary = {
    name: typeof source.name === 'string' ? source.name : 'UnknownError',
    message,
  };

  if (typeof source.status === 'number') {
    summary.status = source.status;
  } else if (typeof source.statusCode === 'number') {
    summary.status = source.statusCode;
  }
  if (typeof source.type === 'string') {
    summary.type = source.type;
  }
  if (typeof source.code === 'string' || typeof source.code === 'number') {
    summary.code = source.code;
  }

  return summary;
}

/** True when `error` is a body-parser error with the given `type`. */
function isBodyParserError(error: unknown, type: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === type
  );
}

/**
 * Central error handler.
 *
 * Client-safe `ApiError`s keep their code and message. Body-parser failures are
 * client faults and are mapped to typed 400/413 responses instead of a generic
 * 500, so the customer is told what to correct. Everything else becomes a
 * generic 500: Mongo internals and stack traces never reach a customer, and the
 * error object is never logged.
 */
const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req: Request,
  res: Response,
  next,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (isApiError(error)) {
    res.status(error.status).json(errorPayload(error.code, error.message));
    return;
  }

  // Malformed JSON body: the caller sent something unparseable.
  if (isBodyParserError(error, 'entity.parse.failed')) {
    res
      .status(400)
      .json(
        errorPayload(
          'INVALID_JSON',
          'The request body is not valid JSON. Please check the request and try again.',
        ),
      );
    return;
  }

  // Body over the configured limit: also the caller's fault.
  if (isBodyParserError(error, 'entity.too.large')) {
    res
      .status(413)
      .json(
        errorPayload(
          'PAYLOAD_TOO_LARGE',
          'The request body is too large. Please shorten your message and try again.',
        ),
      );
    return;
  }

  // Mongoose validation failures are the caller's fault, not a server fault.
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ValidationError'
  ) {
    res
      .status(400)
      .json(errorPayload('INVALID_BODY', 'The submitted reservation was rejected.'));
    return;
  }

  // Log scalars only, server-side. The error object is never passed to the
  // logger because body-parser attaches the raw request body to it.
  console.error('[api] unhandled error:', summarizeErrorForLog(error));
  res
    .status(500)
    .json(errorPayload('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
};

const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(ApiError.notFound('Unknown API route.'));
};

export interface AppOptions {
  /** Rate limiter settings for `POST /api/reservations`. */
  reservationRateLimit?: ReservationsRouterOptions['rateLimit'];
}

/** Builds the Express app. Exported separately so tests can mount it without a listener. */
export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  /**
   * Health, plus the restaurant's current date.
   *
   * `today` is here so the client can pick a valid default booking date before
   * its first availability call. Deriving that default from the browser clock
   * breaks for any customer in a timezone where the calendar day differs from
   * the restaurant's (audit 4.6).
   */
  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      today: todayInRestaurantTimezone(),
      timezone: RESTAURANT_TIMEZONE,
    });
  });

  app.use('/api/availability', availabilityRouter);
  app.use(
    '/api/reservations',
    createReservationsRouter({ rateLimit: options.reservationRateLimit }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { summarizeErrorForLog };
