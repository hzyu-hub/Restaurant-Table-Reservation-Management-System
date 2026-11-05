# Restaurant-Table-Reservation-Management-System

MERN restaurant table reservation system (SDLC Team 5). This repository currently
contains the **Sprint 1 vertical slice**: a customer-facing availability and
booking flow, backed by a concurrency-safe reservation engine.

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

Staff tooling (authentication, seating, cancellations) is Sprint 3 and is not
part of this slice.

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

Then set `MONGODB_URI` in `server/.env` to your connection string:

```
MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority"
PORT=4000
```

`PORT` defaults to `4000`. The Vite dev server proxies `/api` to it.

## Seed the database

```bash
npm run seed
```

Creates six tables (capacities 2, 2, 4, 4, 6, 8) and one staff account
(`staff`). The script is idempotent — running it repeatedly leaves the same six
tables and one staff user. It requires `MONGODB_URI`; without it the script
prints setup instructions and exits non-zero instead of crashing.

## Run in development

```bash
npm run dev
```

- API: http://localhost:4000
- Customer app: http://localhost:5173

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

The suite is **60 tests across 11 files**. It covers the public API contract and,
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
| Party size range | 1 – 20 |
| Statuses | `CONFIRMED`, `SEATED`, `COMPLETED`, `CANCELLED`, `NO_SHOW` |
| Statuses that block capacity | `CONFIRMED`, `SEATED` |

Past start times are rejected. There is no customer self-cancellation and no
email/SMS confirmation in this milestone.

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
    lib/              time (local<->UTC), validation, http errors, slots, rate-limit
    models/           Table, Reservation, StaffUser, TableSlot
    services/booking.ts availability + booking orchestration
    routes/           availability, reservations
    scripts/seed.ts   idempotent table + staff seeding
  tests/              11 files, 60 tests (see Test section)
client/
  src/                single-page React app (api.ts, App.tsx, components/)
```
