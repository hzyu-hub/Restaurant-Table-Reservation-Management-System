# Restaurant-Table-Reservation-Management-System

MERN restaurant table reservation system (SDLC Team 5). This repository currently
contains the customer booking flow and the Sprint 3 staff tools: sign-in,
a date-filtered dashboard, and reservation status changes.

## What works today

- Browse availability for any upcoming date and party size — 20 bookable start
  times per day, every 30 minutes from 11:00 to 20:30 local time.
- Book a table. Each booking holds 90 minutes (three consecutive 30-minute
  slots) and is assigned the smallest table that fits the party.
- Double-booking is prevented **in the database**, not in application code, so
  it holds even with several API processes running.
- Startup **refuses to boot** if that unique index is missing or non-unique, so
  the system cannot silently begin double booking after a bad migration or a
  database restore.
- Orphaned slot rows from a crashed request are swept at startup, with a grace
  period so in-flight bookings are never touched.
- A single-page React client for the whole flow, with a booking reference and
  an on-screen confirmation.

Staff sign in from the Staff link on the booking page. The dashboard lists
one date and can seat, complete, cancel, or mark a no-show. Cancelling,
completing, or marking a no-show releases that table. Seating does not.

## Prerequisites

- Node.js 20 or newer (developed on Node 24)
- npm 10 or newer
- A MongoDB database — a free [Atlas](https://www.mongodb.com/atlas) cluster is
  easiest. No local `mongod` is required, and **tests never touch your real
  database** (they start an ephemeral in-memory MongoDB instead).

## Install

```bash
npm install
```

This installs both workspaces (`server` and `client`) from the repository root.

## Configure

```bash
cp server/.env.example server/.env
```

Then set these values in `server/.env`:

```
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority"
PORT=4000
JWT_SECRET="<at least 32 random characters>"
SEED_STAFF_PASSWORD="<password you can type at staff sign-in>"
```

`PORT` defaults to `4000`. The Vite dev server proxies `/api` to it.

`JWT_SECRET` is required and must be at least 32 characters. Staff sign-in returns
`500 AUTH_NOT_CONFIGURED` when it is missing or shorter. `SEED_STAFF_PASSWORD` is
the password for the seeded username `staff`.

## Seed the database

```bash
npm run seed
```

Creates six tables (capacities 2, 2, 4, 4, 6, 8) and one staff account
(`staff`). The password comes from `SEED_STAFF_PASSWORD`. If that variable is
unset, the script generates a random password and prints it once. Running the
seed again replaces the stored password hash.

The script is idempotent for the six tables: running it repeatedly leaves the
same six tables and one staff user. It requires `MONGODB_URI`. Without it, the
script prints setup instructions and exits non-zero instead of crashing.

## Run in development

```bash
npm run dev
```

- API: http://localhost:4000
- Customer app: http://localhost:5173

The five-minute presentation path is in [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md).

Useful subsets:

```bash
npm run dev:server   # API only (tsx watch)
npm run dev:client   # Vite only
```

## Test

```bash
npm test
```

Runs the server test suite with Vitest against `mongodb-memory-server` — a real
MongoDB instance, with real unique indexes, no mocking. The first run downloads
a MongoDB binary and may take a minute; later runs are fast.

The suite is **77 tests across 13 files**. It covers the public API contract and,
most importantly, the correctness properties:

| File | Guards |
| --- | --- |
| `concurrency.test.ts` | Five simultaneous bookings for the same table and window produce exactly one `201`, four `409`s, and exactly three slot rows |
| `index-guard.test.ts` | Startup aborts when the unique index is missing, non-unique, or shadowed by a name collision |
| `invariant.test.ts` | Slot rows exist if and only if the owning reservation is in a blocking status |
| `architecture.test.ts` | No file outside `lib/slots.ts` imports the slot model |
| `reconciler.test.ts` | Orphaned slot rows older than the grace period are removed |
| `error-handling.test.ts` | Malformed JSON returns 400, oversized bodies 413, and no customer PII reaches the log |
| `status-transitions.test.ts` | All 25 status pairs match the transition matrix |
| `staff-auth.test.ts` | Login issues a bearer token, bad logins are indistinguishable, the staff list is one local date |
| `staff-status.test.ts` | A legal status change is saved, an illegal one is rejected, and cancelling frees only that table |
| `rate-limit.test.ts` | `POST /api/reservations` is throttled; availability is not |
| `performance.test.ts` | Availability latency against the PRD 2 second target |

Removing the unique index makes `concurrency.test.ts` and `index-guard.test.ts`
fail. That is the point: the guard is checked, not assumed.

## Build

```bash
npm run build            # type-checks and bundles the client into client/dist
npm run typecheck        # tsc --noEmit for both workspaces
```

## Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request to `main`, on Node 20
and Node 22: `npm ci`, then `npm run typecheck`, then `npm test`, then the client
build. The test suite needs no database service because it starts an ephemeral
MongoDB itself.

## Booking rules

| Rule | Value |
| --- | --- |
| Restaurant timezone | `America/Toronto` (DST aware) |
| Service hours | 11:00 – 22:00 local |
| Booking duration | 90 minutes |
| Slot increment | 30 minutes |
| Bookable start times | 11:00, 11:30 … 20:30 (20 per day) |
| Slots held per booking | 3 |
| Party size, accepted range | 1 to 20 (input sanity bound) |
| Party size, largest seatable | 8, from the seeded tables |
| Statuses | `CONFIRMED`, `SEATED`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| Statuses that block capacity | `CONFIRMED`, `SEATED` |

Past start times are rejected. There is no customer self-cancellation and no
email/SMS confirmation in this milestone.

A party larger than the largest active table gets `409 NO_TABLE_AVAILABLE` with a
message naming the real maximum and directing the customer to phone the restaurant.
The maximum is read from the table inventory at request time, so it never drifts from
the seeded data. Table combining is out of scope.

## API

All errors use `{ "error": { "code": string, "message": string } }`. Stack
traces and database internals are never returned to a client.

### `GET /api/health`

```json
{ "ok": true, "today": "2026-11-17" }
```

`today` is the restaurant-local date. The client uses it to seed the date input
instead of the browser clock, so a customer in another timezone does not get a
`400 DATE_IN_PAST` on first page load.

### `GET /api/availability?date=YYYY-MM-DD&partySize=N`

Both parameters are required. Returns all 20 start times for the day, including
unavailable ones.

```json
{
  "date": "2026-11-17",
  "partySize": 2,
  "timezone": "America/Toronto",
  "today": "2026-11-17",
  "durationMinutes": 90,
  "slots": [
    {
      "startTime": "2026-11-17T16:00:00.000Z",
      "endTime": "2026-11-17T17:30:00.000Z",
      "available": true,
      "tablesAvailable": 6
    }
  ]
}
```

`400` — `INVALID_DATE`, `INVALID_PARTY_SIZE`, `DATE_IN_PAST`.

### `POST /api/reservations`

```json
{
  "customerName": "Ada Lovelace",
  "customerEmail": "ada@example.com",
  "customerPhone": "416-555-0134",
  "partySize": 2,
  "date": "2026-11-17",
  "time": "18:00"
}
```

`201`

```json
{
  "reference": "R7KMYKSQ",
  "table": { "label": "T1", "capacity": 2 },
  "startTime": "2026-11-17T23:00:00.000Z",
  "endTime": "2026-11-18T00:30:00.000Z",
  "status": "CONFIRMED",
  "customerName": "Ada Lovelace",
  "partySize": 2
}
```

| Status | Codes | Meaning |
| --- | --- | --- |
| `400` | `INVALID_BODY`, `INVALID_NAME`, `INVALID_PHONE`, `INVALID_EMAIL`, `INVALID_PARTY_SIZE`, `INVALID_DATE`, `INVALID_TIME`, `OUTSIDE_SERVICE_HOURS`, `RESERVATION_IN_PAST`, `INVALID_JSON` | The request is malformed or the details are not bookable |
| `409` | `NO_TABLE_AVAILABLE` | No table is big enough for the party |
| `409` | `BOOKING_CONFLICT` | That window was taken first |
| `413` | `PAYLOAD_TOO_LARGE` | Request body over 64 kb |
| `429` | `RATE_LIMITED` | More than 10 booking attempts per minute from one address |
| `503` | `CAPACITY_EXHAUSTED` | Internal candidate exhaustion; distinct from a real conflict |

### `POST /api/auth/login`

```json
{
  "username": "staff",
  "password": "the seeded password"
}
```

`200` returns a bearer token. Send it as `Authorization: Bearer <token>`.
No cookie is set.

```json
{
  "token": "<jwt>",
  "tokenType": "Bearer",
  "expiresInSeconds": 28800,
  "staff": { "username": "staff", "role": "staff" }
}
```

`400 INVALID_CREDENTIALS` means the body is incomplete. `401 INVALID_CREDENTIALS`
means the username or password is wrong. Those two failures use the same code and
message, so the response does not reveal which accounts exist. `JWT_SECRET` is
required and must be at least 32 characters. Login returns
`500 AUTH_NOT_CONFIGURED` when it is missing.

### `GET /api/staff/reservations?date=YYYY-MM-DD`

Requires a valid staff bearer token. Returns reservations whose start time falls
on that restaurant-local date, ordered earliest first, including customer contact
details. A 20:30 booking stays on its local date even when its UTC instant is on
the next calendar day.

`401 UNAUTHENTICATED` means the token is missing or invalid. `400 INVALID_DATE`
means the date is not a real `YYYY-MM-DD` value.

### `PATCH /api/staff/reservations/:reference/status`

Requires a valid staff bearer token. Body:

```json
{ "status": "SEATED" }
```

`reference` is the public booking reference, not the database id. Allowed
changes: `CONFIRMED` to `SEATED`, `CANCELLED`, or `NO_SHOW`; `SEATED` to
`COMPLETED`. `COMPLETED`, `CANCELLED`, and `NO_SHOW` do not change again.
Sending the status the reservation already has returns `200` and changes
nothing.

Leaving `CONFIRMED` or `SEATED` for a status that does not hold a table deletes
that reservation's slot rows, so the table can be booked again. `SEATED` still
holds the table.

`200` returns the updated reservation, including contact details. `400
INVALID_STATUS` means the status is not one of the five. `409
INVALID_TRANSITION` means the matrix forbids the change and nothing was saved.
`404 NOT_FOUND` means the reference does not exist.

## How double-booking is prevented

The `tableSlots` collection stores one row per occupied 30-minute slot per
table, with a **unique compound index on `{ tableId, slotStart }`**.

Creating a reservation never checks-then-inserts. Instead it:

1. Validates the request and resolves the local wall-clock time to a UTC window.
2. Picks candidate tables, smallest sufficient capacity first.
3. Generates the reservation's `ObjectId` up front.
4. `insertMany`s the three slot rows with `{ ordered: false }`. A racing request
   loses the unique-index race and gets a duplicate-key error (code `11000`).
5. On a duplicate key it deletes any rows written by that attempt
   (`deleteMany({ reservationId })`), then tries the next candidate table, up to
   five attempts, before returning `409`.
6. Only once the slots are secured does it write the `Reservation`. If that
   write fails, the slot rows are released again.

Because `ordered: false` allows partial insertion, the cleanup step in step 5 is
required for correctness, not defensive coding.

## Project layout

```
package.json          npm workspaces root (dev, test, seed, build, typecheck)
server/
  src/
    index.ts          entry point: connect to Mongo, start Express
    app.ts            Express app factory (mounted directly by tests)
    db.ts             Mongoose connection helpers
    config/booking.ts service hours, duration, statuses, transitions, timezone
    lib/              time, validation, auth, http errors, slots, rate-limit
    middleware/       staff bearer-token guard
    models/           Table, Reservation, StaffUser, TableSlot
    services/         booking orchestration, staff list and status changes
    routes/           auth, availability, reservations, staff
    scripts/seed.ts   idempotent table + staff seeding
  tests/              13 files, 77 tests (see Test section)
client/
  src/                single-page React app (api.ts, App.tsx, components/)
```
