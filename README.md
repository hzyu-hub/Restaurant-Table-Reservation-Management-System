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
- A single-page React client for the whole flow.

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

The suite covers the public API contract and, most importantly,
`server/tests/concurrency.test.ts`: five simultaneous bookings for the same
table and window must produce exactly one `201`, four `409`s, and exactly three
slot rows. Removing the unique index makes that test fail.

## Build

```bash
npm run build            # type-checks and bundles the client into client/dist
npm run typecheck        # tsc --noEmit for both workspaces
```

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
{ "ok": true }
```

### `GET /api/availability?date=YYYY-MM-DD&partySize=N`

Both parameters are required. Returns all 20 start times for the day, including
unavailable ones.

```json
{
  "date": "2026-11-17",
  "partySize": 2,
  "timezone": "America/Toronto",
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

`400` — `INVALID_BODY`, `INVALID_NAME`, `INVALID_PHONE`, `INVALID_EMAIL`,
`INVALID_PARTY_SIZE`, `INVALID_DATE`, `INVALID_TIME`, `OUTSIDE_SERVICE_HOURS`,
`RESERVATION_IN_PAST`.

`409` — `NO_TABLE_AVAILABLE` (no table is big enough) or `BOOKING_CONFLICT`
(that window was taken first).

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
    config/booking.ts service hours, duration, statuses, timezone
    lib/              time (local<->UTC), validation, http errors
    models/           Table, Reservation, StaffUser, TableSlot
    services/booking.ts availability + the FR4 concurrency guard
    routes/           availability, reservations
    scripts/seed.ts   idempotent table + staff seeding
  tests/              availability, booking, concurrency
client/
  src/                single-page React app (api.ts, App.tsx, components/)
```
