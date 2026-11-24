import type { NextFunction, Request, Response } from 'express';
import { authenticateAccountToken, type AuthenticatedAccount } from '../lib/auth.js';
import { ApiError } from '../lib/http.js';

declare module 'express-serve-static-core' {
  interface Request {
    account?: AuthenticatedAccount;
  }
}

export function requireAccount(req: Request, _res: Response, next: NextFunction): void {
  req.account = authenticateAccountToken(req.header('authorization'));
  next();
}

export function requireCustomer(req: Request, _res: Response, next: NextFunction): void {
  req.account = authenticateAccountToken(req.header('authorization'));
  if (req.account.role !== 'customer') {
    throw new ApiError(403, 'FORBIDDEN', 'Customer access is required.');
  }
  next();
}
