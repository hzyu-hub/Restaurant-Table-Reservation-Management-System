# Implementation Plan

Restaurant Table Reservation Management System
SDLC Team 5, Fall 2026, Laurentian University

Derived from `SDLC_Team5_PRD.docx` v1.1 (2 November 2026).
Document status: living. Updated as sprints complete.

---

## 1. Where the project actually stands

Verified against commit `0b7a504` (tag `v0.2.0`), not from memory.

### 1.1 Built and working

| Area | State | Evidence |
| --- | --- | --- |
| Availability lookup (FR1) | Done | `GET /api/availability`, 20 slots per day returned |
| Booking submission and validation (FR2) | Done | `parseReservationInput`, 400 with typed error codes |
| Useful error messages (FR7) | Partial | Field-level 400s are good, but malformed JSON and bodies over 64 kb return 500, not 400 |
| Reservation creation and reference (FR3) | Done | `POST /api/reservations`, 8-char reference |
| Conflict prevention (FR4) | Done | unique index on `tableSlots{tableId, slotStart}` |
| Data persistence | Done | 4 Mongoose models |
| Customer UI (FR8) | Done | React single page, responsive |
| Automated tests | Done | 60 tests across 11 files, real ephemeral MongoDB |
| Index guard (FR4 hardening) | Done | Startup asserts the unique index exists and is unique; boot aborts otherwise |
| Orphan reconciler | Done | Startup sweep with a 60 s grace period |
| Status transition matrix | Done (data only) | `ALLOWED_TRANSITIONS` plus tests; the endpoint is Sprint 3 |
| CI pipeline | Done | `.github/workflows/ci.yml` on push and PR |
| Rate limiting | Done | 10/min per IP on POST `/api/reservations` |
| Seed data | Done | 6 tables, 1 staff account, idempotent |

### 1.2 Not built

| PRD item | Sprint | Note |
| --- | --- | --- |
| FR5 staff view reservations | 3a | No auth exists yet |
| FR6 update reservation status | 3b | Matrix defined, endpoint not built |
| Staff authentication | 3a | `StaffUser` model exists, nothing uses it |
| Deployment | 4 | No hosting configured |
| Mobile verification (PRD matrix row 7) | 4 | Responsive CSS exists, never verified on a device |
| PR review | 4 | PRD Definition of Done requires it; repo has no PR history |

### 1.3 Verified facts about the codebase

These matter for planning because they are constraints, not preferences.

- Node v24.12.0, npm 11.6.2. No pnpm, no Docker, no local `mongod`.
- Tests run against `mongodb-memory-server`, so the suite needs no database.
- `jsonwebtoken` is **not installed** (Sprint 3a). `cookie-parser` is deliberately **not**
  planned: auth will use a token in the `Authorization` header, because cookie auth from
  a different origin needs `cors({ credentials: true })` plus CSRF handling, and the
  current `cors()` is bare.
- `MAX_PARTY_SIZE = 20`, `MIN_PARTY_SIZE = 1`.
- `LAST_BOOKABLE_START_MINUTES = 20:30` (derived: close 22:00 minus 90 minutes).
- `MAX_CANDIDATE_ATTEMPTS = 25`, a safety valve above the table count.
- 763 lines of client TypeScript across 7 files.
- `db.ts` connects with `autoIndex: false` and then calls `ensureSlotIndexes()`, so the
  database user needs index-creation rights. The assertion fails the boot loudly if the
  index is missing or non-unique, rather than serving traffic without the double-booking
  guard.

---

## 2. Architecture as implemented

```
Browser (React + Vite, :5173)
   |  fetch /api/*, proxied in dev
   v
Express API (:4000)
   |  routes -> validation -> service -> models
   v
MongoDB Atlas
```

Layer responsibilities, matching the files on disk:

| Layer | Files | Rule |
| --- | --- | --- |
| Config | `config/booking.ts` | Booking rules live here. Known exceptions: `services/booking.ts:118` and `client/src/App.tsx:184` both restate the service window in text. |
| Time | `lib/time.ts` | The only place the **server** converts local wall clock to UTC. The client converts independently for display (`App.tsx`, `SlotPicker.tsx`, `Confirmation.tsx`). |
| Validation | `lib/validation.ts` | Narrows `unknown` to typed values, throws `ApiError(400)`. |
| Errors | `lib/http.ts` | `ApiError` plus `asyncHandler` for Express 4 promise rejection. |
| Slots | `lib/slots.ts` | **The only module that imports `TableSlot`.** Exports `reserveWindow`, `releaseWindow`, `findOccupiedSlots`, `ensureSlotIndexes`, `assertSlotUniqueIndex`, `reconcileOrphanedSlots`. Enforced by `tests/architecture.test.ts`. |
| Service | `services/booking.ts` | Business rules. Calls `lib/slots.ts`; never touches the slot collection directly. |
| Rate limit | `lib/rate-limit.ts` | Throttle on `POST /api/reservations`. Disabled in tests via env switch. |
| Routes | `routes/*.ts` | Parse request, call service, set status. No business logic. |
| Models | `models/*.ts` | Schema plus indexes. No business logic. |

Two invariants the code depends on:

1. **`lib/time.ts` is the sole timezone boundary.** `America/Toronto` observes DST. Every instant stored in Mongo is UTC; every rule is expressed in local wall-clock minutes. Mixing the two anywhere else reintroduces DST bugs.
2. **`lib/slots.ts` is the sole importer of `TableSlot`.** Slot rows must only ever be created or deleted through `reserveWindow` and `releaseWindow`, or the slot table drifts out of sync with `reservations`. This is now mechanically enforced: `tests/architecture.test.ts` greps the source tree and fails if any other file imports the model.

---

## 3. Design decisions and their rationale

### 3.1 Conflict prevention: database-enforced, not check-then-insert

**Problem.** The PRD test matrix includes "two simultaneous bookings for final table: at most one succeeds". A naive implementation reads availability, then inserts. Both requests read "free", both insert, both succeed. This passes manual testing and fails under concurrency.

**Decision.** A 90-minute booking occupies three consecutive 30-minute rows in `tableSlots`, guarded by a unique compound index on `{tableId, slotStart}`. The insert itself is the arbitration. Losers get a duplicate-key error, delete their partial rows, and retry the next candidate table.

**Why this over alternatives.**

- A MongoDB transaction with a read-then-write is correct but requires a replica set and still contends on retries. The unique index works on any deployment.
- An in-process mutex fails the moment a second API instance runs.
- A pessimistic lock collection adds a second source of truth to keep consistent.

**Cost.** Bookings must align to the 30-minute grid. That is acceptable and is now a stated product rule.

**Cleanup is mandatory, not defensive.** `insertMany` uses `{ ordered: false }`, so a rejected attempt may have already written some of its three rows. The `deleteMany({ reservationId })` before returning 409 is load-bearing.

### 3.2 Timezone

Restaurant rules are wall-clock (`11:00` means 11:00 in Toronto). Storage is UTC. `lib/time.ts` owns the conversion via `date-fns-tz`. A booking made before and after a DST change on the same date would otherwise shift by an hour.

### 3.3 Table assignment

Best fit: the smallest active table whose capacity is at least the party size. Reduces wasted large tables. Candidates are tried in ascending capacity order, so a party of 2 is never seated at the 8-seater while a 2-seater is free.

---

## 4. Booking rules, as implemented

| Rule | Value | Source |
| --- | --- | --- |
| Service hours | 11:00 to 22:00 local | team decision 2026-11-03 |
| Booking duration | 90 minutes | PRD section 5 |
| Slot increment | 30 minutes | team decision 2026-11-03 |
| Bookable start times | 11:00 to 20:30 (20 slots) | derived |
| Party size | 1 to 20 | implementation limit |
| Blocking statuses | `CONFIRMED`, `SEATED` | PRD section 5 |
| Non-blocking statuses | `COMPLETED`, `CANCELLED`, `NO_SHOW` | PRD section 5 |
| Past dates | rejected | PRD section 5 |

### 4.1 Status transition matrix

Defined in `config/booking.ts` as `ALLOWED_TRANSITIONS`, with `isTransitionAllowed`
and `holdsCapacity` helpers. `tests/status-transitions.test.ts` checks all 25 pairs.

| From | Allowed to | Holds capacity after |
| --- | --- | --- |
| `CONFIRMED` | `SEATED`, `CANCELLED`, `NO_SHOW` | yes for SEATED, no otherwise |
| `SEATED` | `COMPLETED` | no |
| `COMPLETED` | none (terminal) | no |
| `CANCELLED` | none (terminal) | no |
| `NO_SHOW` | none (terminal) | no |

`CONFIRMED -> SEATED` is the only edge that stays inside the blocking set. Every other
outgoing edge must release the reservation's slot rows through `releaseWindow`. The
invariant is: slot rows exist if and only if the status is in `BLOCKING_STATUSES`.

Table seed data: capacities 2, 2, 4, 4, 6, 8 (six tables, 26 seats).

---

## 5. API contract, as implemented

### `GET /api/health`
`200 { ok: true, today: "2026-11-05" }`

`today` is the restaurant-local date. The client uses it to seed the date input
instead of the browser clock, which is what fixes the cross-timezone bug where a
customer west of Toronto got `400 DATE_IN_PAST` on first page load.

### `GET /api/availability?date=YYYY-MM-DD&partySize=N`
Both parameters required.

`200`
```json
{
  "date": "2026-11-05",
  "partySize": 2,
  "timezone": "America/Toronto",
  "durationMinutes": 90,
  "slots": [
    { "startTime": "2026-11-05T16:00:00.000Z", "endTime": "2026-11-05T17:30:00.000Z",
      "available": true, "tablesAvailable": 6 }
  ]
}
```

All 20 slots are returned, unavailable ones included, so the client renders a stable grid.

The payload also carries `today` (restaurant-local `YYYY-MM-DD`), refreshed on every
response so a page left open overnight survives midnight.

Errors: `400 INVALID_DATE`, `400 INVALID_PARTY_SIZE`, `400 DATE_IN_PAST`.

### `POST /api/reservations`
```json
{ "customerName": "Ada Lovelace", "customerEmail": "ada@example.com",
  "customerPhone": "+17055550142", "partySize": 2,
  "date": "2026-11-05", "time": "18:00" }
```

`201`
```json
{ "reference": "R7K4M9QX", "table": { "label": "T3", "capacity": 4 },
  "startTime": "2026-11-05T23:00:00.000Z", "endTime": "2026-11-06T00:30:00.000Z",
  "status": "CONFIRMED", "customerName": "Ada Lovelace", "partySize": 2 }
```

Errors:

| Status | Codes |
| --- | --- |
| 400 | `INVALID_NAME`, `INVALID_PHONE`, `INVALID_EMAIL`, `INVALID_PARTY_SIZE`, `INVALID_DATE`, `INVALID_TIME`, `INVALID_BODY`, `OUTSIDE_SERVICE_HOURS`, `RESERVATION_IN_PAST`, `INVALID_JSON` |
| 409 | `BOOKING_CONFLICT`, `NO_TABLE_AVAILABLE` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 429 | `RATE_LIMITED` (10 requests per minute per IP) |
| 503 | `CAPACITY_EXHAUSTED` (internal candidate exhaustion, distinct from a real conflict) |

### Error envelope
Every error, without exception:
```json
{ "error": { "code": "BOOKING_CONFLICT", "message": "That time slot was just taken. Please choose another time." } }
```
Stack traces and Mongo internals are never returned to the client. Server-side logs
record only `name`, `message` (truncated), `status`, `type` and `code`. The error
object is never logged as a whole, because for a body-parser failure it carries the
request body, which contains the customer's name, phone and email. The PRD Privacy
requirement forbids that, and `tests/error-handling.test.ts` asserts it.

### Not yet implemented (Sprint 3)
`POST /api/auth/login`, `GET /api/staff/reservations`, `PATCH /api/staff/reservations/:id/status`.

---

## 6. Sprint plan

### Sprint 0: foundations (mostly done)
- [x] Requirements confirmed from PRD
- [x] Architecture decided
- [x] Repository scaffolded, npm workspaces
- [x] Booking rules locked
- [x] CI: `.github/workflows/ci.yml` runs `npm ci`, typecheck, tests and client build on push and PR
- [x] `.env.example` documented for the team

### Sprint 1: customer booking (done)
- [x] Models: `tables`, `reservations`, `tableSlots`, `staffUsers`
- [x] `GET /api/availability`
- [x] `POST /api/reservations` with concurrency guard
- [x] React booking flow
- [x] Seed script
- [x] 60 tests including the parallel race, the index guard, the invariant, and the reconciler

### Sprint 2: hardening (done)
- [x] Input validation on every field
- [x] Central error handler, no internal leakage
- [x] Request body size limit (64 kb)
- [x] `x-powered-by` disabled
- [x] Rate limiting on `POST /api/reservations` (10 per minute per IP, 429 `RATE_LIMITED`)
- [x] Malformed JSON and oversized bodies return 400 and 413, not 500
- [x] Server logs contain no customer PII
- [x] Startup asserts the unique index exists and is unique
- [x] Orphaned slot reconciler at startup
- [x] Unique index declared in exactly one place, with `autoIndex: false`
- [ ] Reservation reference collision handling. There is no retry: a duplicate
      `reference` makes `Reservation.create` throw, which deletes the slot rows
      and returns 500. Probability is negligible (`booking.ts:64-75`, 7 chars
      over a 32-character alphabet), but the behaviour is a 500, not a retry.
- [ ] CORS policy. `cors()` is currently bare, reflecting any origin. Acceptable for
      a public booking API, but it must be revisited if auth ever moves to cookies.

### Sprint 3: staff tooling (next)

Split in two, because auth and slot mutation are independent risks that share no code.
If 3b slips, 3a still gives a working staff view for the demo.

**3a: authentication and read-only dashboard** (additive, low risk; delivers FR5, US3)
- [ ] Auth mechanism decided: **token in `Authorization` header, not cookies.** A
      cookie would require `cors({ origin, credentials: true })` and CSRF handling;
      header auth works with the current `cors()` unchanged. Record this decision.
- [ ] `jsonwebtoken` installed. Do NOT install `cookie-parser`.
- [ ] `POST /api/auth/login`. Note `StaffUser.passwordHash` is `select: false`, so the
      query must explicitly `.select('+passwordHash')`.
- [ ] Login hardening: identical error for unknown user and wrong password, and hash a
      dummy value when the user does not exist, so response timing cannot enumerate
      accounts. `bcrypt.compare` is not constant-time in the way that matters here.
- [ ] `requireStaff` middleware
- [ ] `GET /api/staff/reservations?date=YYYY-MM-DD`
- [ ] Staff login page plus a date-filtered dashboard
- [ ] Tests: unauthenticated access denied, valid login issues a token, wrong password
      and unknown user are indistinguishable

**3b: status transitions** (mutating, high risk; delivers FR6, US4)
- [ ] `PATCH /api/staff/reservations/:id/status`, validating against
      `ALLOWED_TRANSITIONS` in `config/booking.ts`
- [ ] Release slot rows through `releaseWindow` in `lib/slots.ts` whenever the
      transition moves the reservation out of `BLOCKING_STATUSES`. Never call
      `TableSlot` directly; `tests/architecture.test.ts` will fail if you do.
- [ ] Status controls in the dashboard
- [ ] Tests: valid transition saved, invalid transition rejected, and the **invariant
      test** from `tests/invariant.test.ts` still passing after every transition

The transition matrix is defined in section 4. `CONFIRMED -> SEATED` is the one
blocking-to-blocking edge and it must NOT release slots: seating a customer does not
free their table. Releasing there would let the same table be double-booked for the
same evening.

### Sprint 4: finish
- [ ] Full test matrix from PRD section 9 green
- [ ] **PRD matrix row 7 (mobile layout) needs an owner and a method.** It has neither
      today. Suggested: manual pass at 375x667 and 768x1024 in a real browser,
      screenshot both, record the result in the PR description.
- [ ] Code reviewed through a GitHub pull request. This is the PRD's Definition of
      Done, not optional. The repository currently has no PR history.
- [ ] README and API notes complete
- [ ] Deploy (frontend static host, API on a Node host, Atlas for data)
- [ ] Rotate the seed staff credential. It is env-driven now, so a deployed instance
      must set its own value.
- [ ] Demo script

---

## 7. Test strategy

Current: 60 tests across 11 files, all against a real ephemeral MongoDB via
`mongodb-memory-server`. No mocking of the database, because the concurrency guard is
a database feature and mocking it would test nothing.

| File | Tests | Covers |
| --- | --- | --- |
| `availability.test.ts` | 5 | 20 slots returned, oversized party unavailable, past date rejected |
| `booking.test.ts` | 9 | Creation, reference issued, 3 slot rows, validation failures, off-grid time, outside hours |
| `concurrency.test.ts` | 2 | 5 parallel requests for the last table yield exactly one winner |
| `index-guard.test.ts` | 5 | Unique index asserted at startup; missing, non-unique, and name-collision (code 86) states all abort boot |
| `architecture.test.ts` | 4 | Fails if any file outside `lib/slots.ts` imports `TableSlot`. Includes a negative control so the regex is not vacuous |
| `invariant.test.ts` | 7 | Slot rows exist if and only if the status is blocking, with the exact count. Two negative controls prove it fails when broken |
| `reconciler.test.ts` | 5 | Orphaned slot rows older than the grace period are removed; fresh ones and real bookings survive |
| `error-handling.test.ts` | 6 | Malformed JSON returns 400 `INVALID_JSON`, oversized body 413, and no customer name, phone or email reaches the log |
| `status-transitions.test.ts` | 11 | All 25 status pairs, plus the release-edge set |
| `rate-limit.test.ts` | 5 | POST throttled with 429 `RATE_LIMITED`; availability GET is not throttled |
| `performance.test.ts` | 1 | Availability latency against 20 tables and 42 bookings, measured against the PRD 2 second target |

The concurrency test is the load-bearing one. It was validated with a negative control: dropping the unique index makes all five requests succeed, confirming the test measures the index rather than incidental serialization.

Planned additions in Sprint 3:
- Unauthenticated staff request returns 401
- Cancelling a reservation frees its slots for rebooking
- Invalid status transition rejected

---

## 8. Risks and open items

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Atlas user lacks index-creation rights | API refuses to boot, loudly | Startup assertion names the cause and the fix. Confirm rights before deploy. |
| Team has no Atlas cluster yet | Nobody can run the app | Free M0 tier; tests work without it |
| Slot rows orphaned on status change | Tables blocked forever | `lib/slots.ts` is the sole importer of `TableSlot`, enforced by `architecture.test.ts`; `invariant.test.ts` asserts the cross-collection property |
| Orphaned slots after a process crash | One table blocked with no reservation to explain it | `reconcileOrphanedSlots()` at startup, 60 s grace period, tested |
| Inventory squatting on the public booking endpoint | A script can consume every table for a day in seconds | Rate limit slows it; it does NOT fix it. No hold, no expiry, no customer cancellation, so only Sprint 3 staff tooling can release inventory. **Accepted risk for the demo, not solved.** |
| No CI | Regressions merge unnoticed | `.github/workflows/ci.yml` runs typecheck, tests and client build on push and PR |
| BA/PM and QA owners unnamed | Process gaps at presentation | Team decision, PRD section 11 |
| PRD matrix row 7 (mobile) unowned | Unverified requirement at grading | Assigned a method in Sprint 4 |

Performance is not a risk: measured median 4 ms against a 2000 ms target on 20 tables
and 42 bookings, asserted by `performance.test.ts`.

Privacy: the server never logs customer name, phone or email. `app.ts` logs only
`name`, `message` (truncated), `status`, `type` and `code`, never the error object,
because a body-parser failure carries the request body. Asserted by
`error-handling.test.ts`.

PRD section 11 items still needing team sign-off: table count and capacity (proposed
2/2/4/4/6/8), mandatory contact fields (the code currently makes name and phone
required and email optional, which is a decision baked into a shipped API contract),
hosting, sprint dates, BA/PM and QA owners.

Two rules the PRD marks as **unapproved** are implemented and now structurally baked
into the code, so they need explicit team sign-off rather than silent acceptance:

1. **90 minute booking duration.** PRD section 5 says "not yet approved". It drives
   `SLOTS_PER_BOOKING`, which drives the three-row slot write, so changing it is no
   longer cheap.
2. **`CONFIRMED` and `SEATED` as the blocking set.** PRD section 5 says "the team must
   approve this rule".

Decided and recorded 2026-11-03: service hours 11:00 to 22:00, 30 minute slot
increment, and the status transition matrix in section 4.1.

### Sprint numbering vs the PRD

The PRD's Sprint 1 (pages, API setup, models) and Sprint 2 (availability, booking,
conflict prevention) were delivered together at `v0.2.0` as one vertical slice, because
a booking flow without conflict prevention would be incoherent. Plan Sprint 2 was then
repurposed as hardening, an activity the PRD does not schedule. The PRD's own schedule
table therefore no longer maps one to one onto this document, and progress should be
read from the checklist in section 6 rather than from the PRD's table.

---

## 9. How to run

```bash
npm install
cp server/.env.example server/.env      # set MONGODB_URI
npm run seed                            # 6 tables + staff account
npm run dev                             # API :4000, client :5173
```

```bash
npm test        # 60 tests, no database needed
npm run typecheck
npm run build
```

Seed staff login is username `staff`. The password comes from `SEED_STAFF_PASSWORD`
in `server/.env`. If that variable is unset, `npm run seed` generates a random
password and prints it to stdout exactly once. No password is hardcoded in the source
tree, and none is recorded in this document, so this section cannot drift or leak.
