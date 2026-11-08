/** Express guard for routes that only restaurant staff may use. */
import type { NextFunction, Request, Response } from 'express';
import { authenticateStaffToken, type AuthenticatedStaff } from '../lib/auth.js';

declare module 'express-serve-static-core' {
  interface Request {
    staff?: AuthenticatedStaff;
  }
}

/** Rejects the request unless it carries a valid staff bearer token. */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  req.staff = authenticateStaffToken(req.header('authorization'));
  next();
}
