/**
 * Transport-agnostic HTTP error type plus a wrapper that funnels rejected
 * promises into Express' error pipeline (Express 4 does not do this itself).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** An error whose message is safe to show to API clients. */
export class ApiError extends Error {
  public readonly status: number;

  public readonly code: string;

  public constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  public static badRequest(code: string, message: string): ApiError {
    return new ApiError(400, code, message);
  }

  public static notFound(message = 'Resource not found.'): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  public static conflict(code: string, message: string): ApiError {
    return new ApiError(409, code, message);
  }
}

/** Shape of every error payload the API emits. */
export interface ErrorPayload {
  error: {
    code: string;
    message: string;
  };
}

/**
 * Builds the one error envelope the API uses everywhere.
 *
 * Lives here rather than in `app.ts` so non-route middleware (the rate limiter)
 * can emit the same shape without importing the app module.
 */
export function errorPayload(code: string, message: string): ErrorPayload {
  return { error: { code, message } };
}

/** True when the value is a well-formed `ApiError`. */
export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/**
 * Wraps an async route handler so a rejected promise reaches the central error
 * middleware instead of hanging the request.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
