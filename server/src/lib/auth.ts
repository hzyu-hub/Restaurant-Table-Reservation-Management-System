/** Shared account authentication using signed bearer tokens, never cookies. */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ApiError } from './http.js';
import { StaffUser, type StaffUserDocument } from '../models/StaffUser.js';
import { parseCustomerName, parseCustomerPhone, parseOptionalEmail } from './validation.js';

export const STAFF_TOKEN_TTL_SECONDS = 8 * 60 * 60;
const DUMMY_PASSWORD_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8i6r3fXq4n0h1p2q3r4s5t6u7v8w9u';
const INVALID_LOGIN_MESSAGE = 'The username or password is incorrect.';

export type AccountRole = 'customer' | 'staff' | 'admin';
export interface AuthenticatedStaff {
  username: string;
  role: 'staff' | 'admin';
}
export interface AuthenticatedAccount {
  id: string;
  username: string;
  role: AccountRole;
}
export interface AccountProfile extends AuthenticatedAccount {
  name: string;
  phone: string;
  email: string | null;
}
export interface AccountSession {
  token: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: AccountProfile;
  staff?: AuthenticatedStaff;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret === undefined || secret.length < 32) {
    throw new ApiError(500, 'AUTH_NOT_CONFIGURED', 'Sign-in is not configured.');
  }
  return secret;
}
function isAccountRole(value: unknown): value is AccountRole {
  return value === 'customer' || value === 'staff' || value === 'admin';
}
function parseLoginBody(body: unknown): { username: string; password: string } {
  if (!isRecord(body) || typeof body.username !== 'string' || typeof body.password !== 'string' ||
    body.username.trim().length === 0 || body.username.length > 256 ||
    body.password.length === 0) {
    throw ApiError.badRequest('INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }
  return { username: body.username.trim().toLowerCase(), password: body.password };
}
function sessionFor(user: StaffUserDocument): AccountSession {
  const profile: AccountProfile = {
    id: String(user._id), username: user.username, role: user.role,
    name: user.name ?? '', phone: user.phone ?? '', email: user.email ?? null,
  };
  // Keep username as subject for compatibility with existing staff tokens.
  const token = jwt.sign({ role: user.role, accountId: profile.id }, jwtSecret(), {
    algorithm: 'HS256', subject: user.username, expiresIn: STAFF_TOKEN_TTL_SECONDS,
  });
  return {
    token, tokenType: 'Bearer', expiresInSeconds: STAFF_TOKEN_TTL_SECONDS, user: profile,
    ...(user.role === 'customer' ? {} : { staff: { username: user.username, role: user.role } }),
  };
}

/** Existing exported entry point also accepts customer credentials. */
export async function loginStaff(body: unknown): Promise<AccountSession> {
  const credentials = parseLoginBody(body);
  const user = await StaffUser.findOne({ username: credentials.username }).select('+passwordHash');
  const matches = await bcrypt.compare(credentials.password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  if (user === null || !matches || !isAccountRole(user.role)) {
    throw new ApiError(401, 'INVALID_CREDENTIALS', INVALID_LOGIN_MESSAGE);
  }
  return sessionFor(user);
}

export async function registerCustomer(body: unknown): Promise<AccountSession> {
  if (!isRecord(body)) throw ApiError.badRequest('INVALID_BODY', 'Request body must be a JSON object.');
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(username)) {
    throw ApiError.badRequest('INVALID_USERNAME', 'username must be 3 to 64 letters, digits, dots, underscores or hyphens, starting with a letter or digit.');
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || Buffer.byteLength(body.password, 'utf8') > 72) {
    throw ApiError.badRequest('INVALID_PASSWORD', 'password must be at least 8 characters and at most 72 UTF-8 bytes.');
  }
  if (body.role !== undefined && body.role !== 'customer') {
    throw ApiError.badRequest('INVALID_ROLE', 'Registration creates customer accounts only.');
  }
  const name = parseCustomerName({ customerName: body.name });
  const phone = parseCustomerPhone({ customerPhone: body.phone });
  const email = parseOptionalEmail(body.email) ?? null;
  jwtSecret(); // Fail before writing an account if sessions cannot be issued.
  const passwordHash = await bcrypt.hash(body.password, 10);
  let user: StaffUserDocument;
  try {
    user = await StaffUser.create({ username, passwordHash, role: 'customer', name, phone, email });
  } catch (error) {
    if (isRecord(error) && error.code === 11000) {
      throw ApiError.conflict('USERNAME_TAKEN', 'That username is unavailable.');
    }
    throw error;
  }
  return sessionFor(user);
}

/** Signature and algorithm validation happens before any role gate. */
export function authenticateAccountToken(header: unknown): AuthenticatedAccount {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign-in is required.');
  }
  try {
    const decoded = jwt.verify(header.slice(7).trim(), jwtSecret(), { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !isAccountRole(decoded.role) ||
      typeof decoded.sub !== 'string' || decoded.sub.length === 0) throw new Error('Invalid session.');
    const id = typeof decoded.accountId === 'string' ? decoded.accountId : '';
    if ((id !== '' || decoded.role === 'customer') && !/^[a-f0-9]{24}$/.test(id)) {
      throw new Error('Invalid account id.');
    }
    return { id, username: decoded.sub, role: decoded.role };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, 'UNAUTHENTICATED', 'Sign-in is required.');
  }
}
export function authenticateStaffToken(header: unknown): AuthenticatedStaff {
  const account = authenticateAccountToken(header);
  if (account.role === 'customer') throw new ApiError(403, 'FORBIDDEN', 'Staff access is required.');
  return { username: account.username, role: account.role };
}
