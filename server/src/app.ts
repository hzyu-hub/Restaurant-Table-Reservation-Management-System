import cors from 'cors';
import express, {
  type ErrorRequestHandler,
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import { ApiError, isApiError } from './lib/http.js';
import { availabilityRouter } from './routes/availability.js';
import { reservationsRouter } from './routes/reservations.js';

/** Shape of every error payload the API emits. */
interface ErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } };
}

/**
 * Central error handler. Deliberately narrow: client-safe `ApiError`s keep
 * their code, everything else becomes a generic 500 so Mongo internals and
 * stack traces never reach a customer.
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

  // Log server-side only; never forward the message to the client.
  console.error('[api] unhandled error:', error);
  res
    .status(500)
    .json(errorPayload('INTERNAL_ERROR', 'Something went wrong. Please try again.'));
};

const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(ApiError.notFound('Unknown API route.'));
};

/** Builds the Express app. Exported separately so tests can mount it without a listener. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  app.use('/api/availability', availabilityRouter);
  app.use('/api/reservations', reservationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export { errorPayload };
