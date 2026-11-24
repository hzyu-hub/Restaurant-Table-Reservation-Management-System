/** Real staff sessions for integration callers; no production auth bypass. */
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { StaffUser } from '../src/models/StaffUser.js';

let authorization: string | undefined;

export async function initializeStaffSession(): Promise<void> {
  const username = 'booking-test-staff';
  const password = 'integration-' + 'password';
  await StaffUser.create({ username, passwordHash: await bcrypt.hash(password, 4), role: 'staff' });
  const response = await request(createApp()).post('/api/auth/login').send({ username, password });
  const body: unknown = response.body;
  if (response.status !== 200 || typeof body !== 'object' || body === null ||
    !('token' in body) || typeof body.token !== 'string') {
    throw new Error('Test staff login failed.');
  }
  authorization = `Bearer ${body.token}`;
}

export function staffAuthorization(): string {
  if (authorization === undefined) throw new Error('Test staff session was not initialized.');
  return authorization;
}
