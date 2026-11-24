import { ApiRequestError } from './api.ts';

/** Keep response diagnostics at the boundary, out of customer-facing copy. */
export function friendlyError(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 0 || error.status >= 500) {
      return 'We could not connect right now. Please try again in a moment.';
    }
    if (error.status === 401) return 'Your session has ended. Please sign in again.';
    return error.message;
  }
  return 'We could not complete that request. Please try again.';
}

export function isExpired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}
