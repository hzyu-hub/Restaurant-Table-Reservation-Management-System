# Account and reservation layout

Approved direction: the website opens at sign-in. Customers and staff use usernames and passwords. Email is optional. Existing bookings and staff credentials are preserved.

## User experience

- Sign-in screen with a customer registration link.
- Registration collects username, full name, password, phone, and optional email; it cannot grant staff access.
- Customer default: Table Reservation; sidebar: Table Reservation, My Bookings, Sign Out.
- Staff default: Bookings for the restaurant's current date; sidebar: Bookings, New Reservation, Sign Out.
- Bookings includes a date picker, Today, Refresh, and permitted reservation status actions.
- Customer contact fields are prefilled from the account. Customer bookings and cancellations are restricted to the authenticated owner.
- Mobile navigation collapses into a menu, booking records stack, and controls remain keyboard accessible.
- Reuse the current warm neutral colors, rust accent, and existing booking components. Avoid decorative content.
- Retain guest choices 1 through 10 and existing seating inventory. This redesign does not add larger tables or table combinations.

## Shared API contract

Session response for registration and login:

```typescript
interface AccountProfile {
  id: string;
  username: string;
  role: 'customer' | 'staff' | 'admin';
  name: string;
  phone: string;
  email: string | null;
}
interface AccountSession {
  token: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: AccountProfile;
}
```

- POST /api/auth/register: {username, password, name, phone, email?}; 201 session. Customer role is assigned by the server.
- POST /api/auth/login: {username, password}; 200 session. Preserve the legacy staff response field for staff clients/tests if needed.
- POST /api/reservations: requires a bearer token for either role; same booking body and response as before. Customer ownership comes from the token, never a submitted account ID.
- GET /api/customer/reservations: customer bearer token; {timezone, today, reservations}. Each reservation uses the existing staff reservation fields. Return only that account's records, including past records.
- PATCH /api/customer/reservations/:reference/cancel: customer bearer token; empty body; returns the updated reservation in the existing reservation representation. Only future CONFIRMED reservations belonging to the caller can be cancelled.
- Existing staff reservation routes remain staff-only. New customer tokens must fail staff authorization.
- Unowned historical and staff-created reservations remain staff-accessible and are not claimed by matching email/name/phone.
- Keep session tokens in memory; sign-out clears all account state. Expired sessions return to sign-in.

## Validation and delivery

1. Write and run failing API tests for registration, authentication, booking ownership, unauthorized access, and cancellation before implementing.
2. Preserve single-table concurrency protection and status transition rules; update existing test callers to authenticate where required.
3. Run the full test suite, both TypeScript checks, and the production client build.
4. Exercise registration, login, booking, own-booking listing/cancellation, staff actions, sign-out, and mobile navigation in the browser.
5. Publish via a pull request with required CI checks and annotated semantic version tag; verify both API and GitHub Pages after deployment.
