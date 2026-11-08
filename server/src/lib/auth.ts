/**
 * Staff authentication.
 *
 * The token travels in the `Authorization: Bearer` header, never in a cookie.
 * Cookie auth would require credentialed CORS and CSRF handling; header auth
 * works with the existing bare `cors()`.
 */
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { ApiError } from './http.js';
import { StaffUser } from '../models/StaffUser.js';

/** How long an issued staff token remains usable. */
export const STAFF_TOKEN_TTL_SECONDS = 8 * 60 * 60;

/**
 * Fixed hash compared when the username does not exist.
 *
 * This keeps an unknown user on the same bcrypt path as a wrong password, so
 * response timing cannot be used to enumerate staff accounts.
 */
const DUMMY_PASSWORD_HASH =
  '$2b$10$CwTycUXWue0Thq9StjUM0uJ8i6r3fXq4n0h1p2q3r4s5t6u7v8w9u';

const INVALID_LOGIN_MESSAGE = 'The username or password is incorrect.';

export interface AuthenticatedStaff {
  username: string;
  role: 'staff' | 'admin';
}

export interface StaffLoginResult {
  token: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  staff: AuthenticatedStaff;
}

interface StaffTokenPayload extends JwtPayload {
  sub: string;
  role: AuthenticatedStaff['role'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function jwtSecret(): string {
  const configured = process.env.JWT_SECRET?.trim();
  if (configured === undefined || configured.length < 32) {
    throw new ApiError(
      500,
      'AUTH_NOT_CONFIGURED',
      'Staff sign-in is not configured.',
    );
  }
  return configured;
}

function parseLoginBody(body: unknown): { username: string; password: string } {
  if (!isRecord(body)) {
    throw ApiError.badRequest('INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (username.length === 0 || password.length === 0) {
    throw ApiError.badRequest('INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }

  return { username: username.toLowerCase(), password };
}

function isStaffRole(value: unknown): value is AuthenticatedStaff['role'] {
  return value === 'staff' || value === 'admin';
}

/** Checks staff credentials and issues a bearer token. */
export async function loginStaff(body: unknown): Promise<StaffLoginResult> {
  const credentials = parseLoginBody(body);
  const user = await StaffUser.findOne({ username: credentials.username })
    .select('+passwordHash')
    .lean();

  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const passwordMatches = await bcrypt.compare(credentials.password, passwordHash);
  if (user === null || !passwordMatches || !isStaffRole(user.role)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }

  const signOptions: SignOptions = {
    algorithm: 'HS256',
    expiresIn: STAFF_TOKEN_TTL_SECONDS,
    subject: user.username,
  };
  const token = jwt.sign({ role: user.role }, jwtSecret(), signOptions);

  return {
    token,
    tokenType: 'Bearer',
    expiresInSeconds: STAFF_TOKEN_TTL_SECONDS,
    staff: {
      username: user.username,
      role: user.role,
    },
  };
}

/** Reads and verifies the bearer token from an Authorization header. */
export function authenticateStaffToken(header: unknown): AuthenticatedStaff {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Staff sign-in is required.');
  }

  const token = header.slice('Bearer '.length).trim();
  if (token.length === 0) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Staff sign-in is required.');
  }

  try {
    const decoded = jwt.verify(token, jwtSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !isStaffRole(decoded.role)) {
      throw new Error('Token payload is not a staff session.');
    }
    if (typeof decoded.sub !== 'string' || decoded.sub.length === 0) {
      throw new Error('Token payload is missing its subject.');
    }

    const payload = decoded as StaffTokenPayload;
    return {
      username: payload.sub,
      role: payload.role,
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(401, 'UNAUTHENTICATED', 'Staff sign-in is required.');
  }
}
