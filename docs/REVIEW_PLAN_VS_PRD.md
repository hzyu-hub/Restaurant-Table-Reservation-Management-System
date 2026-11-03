# Architectural Compliance Review: Implementation Plan vs PRD

**Reviewer:** Architect
**Subject:** `docs/IMPLEMENTATION_PLAN.md` (277 lines, untracked working-tree file)
**Baseline:** `SDLC_Team5_PRD.docx` v1.1 (2 November 2026)
**Code verified at:** commit `0b7a504` (tag `v0.2.0`), working tree clean apart from `docs/`
**Review date:** 2026-11-03
**Method:** every claim below was checked against source, not against either document. Behavioural claims marked "(verified by probe)" were confirmed by executing the code.

---

## 0. Verification performed before review

Commands run from the repository root, output reported verbatim.

**`npm test`** -> exit code 0

```
 Test Files  3 passed (3)
      Tests  16 passed (16)
```

**`npm run typecheck`** -> exit code 0

```
> server@0.1.0 typecheck
> tsc --noEmit

> client@0.1.0 typecheck
> tsc --noEmit
```

The plan's headline numbers (16 tests, 3 files, typecheck clean) are **accurate**. Environment claims at `plan:42-44` are also accurate: Node v24.12.0, npm 11.6.2, no `pnpm`, no `docker`, no local `mongod`, and neither `jsonwebtoken` nor `cookie-parser` is installed. `plan:48` ("763 lines of client TypeScript across 7 files") matches `wc -l` exactly. `plan:125` ("capacities 2, 2, 4, 4, 6, 8, 26 seats") matches `server/src/scripts/seed.ts:14-21`.

I also reproduced the plan's strongest methodological claim (`plan:239`: "dropping the unique index makes all five requests succeed"). Confirmed: after `dropIndex('tableId_1_slotStart_1')`, five identical parallel bookings returned `[201,201,201,201,201]` and wrote 15 slot rows. The negative control is real, and the plan deserves credit for having run it.

This is a better-than-average plan. The findings below are real, but they are gaps in a document that is broadly honest about what exists.

---

## 1. Traceability matrix

Status definitions used strictly as instructed: **Missing from plan** means the PRD asks for it and the plan does not mention it anywhere, regardless of whether the code implements it.

| PRD ID | PRD requirement (short) | Status | Where it lives / why absent | Verdict |
| --- | --- | --- | --- | --- |
| FR1 | Check availability by date, time, party size | Implemented | `server/src/routes/availability.ts:16-44`, `server/src/services/booking.ts:151-222`, `client/src/components/SlotPicker.tsx:22-72`. Plan `plan:19`. | OK. Note: the endpoint accepts `date` + `partySize` only and returns all 20 slots (`booking.ts:185`), it does not accept a `time` filter. Strictly less than FR1's wording, functionally more useful. See 3.6. |
| FR2 | Submit name, contact, party size, date, time; reject invalid | Implemented | `server/src/lib/validation.ts:166-182` plus field parsers `:97-163`; error codes surface as 400. Plan `plan:20`. | OK, with one hole: a malformed JSON body returns 500, not 400 (verified by probe). See 2.2. |
| FR3 | Create and save reservation; show reference and confirmation | Implemented | `server/src/services/booking.ts:301-322` (`reference` generated at `:68-75`), `server/src/models/Reservation.ts:6-12`, `client/src/components/Confirmation.tsx:36-86`. Plan `plan:21`. | OK. |
| FR4 | Prevent overlapping reservations for same table, rejected by backend | Implemented | Unique compound index `server/src/models/TableSlot.ts:35`; arbitration at `server/src/services/booking.ts:289`. Plan `plan:22`, `plan:88-100`. | OK and genuinely well designed. Partially overlapping windows also rejected (verified by probe: 18:00 booking blocks 19:00 and 17:30). |
| FR5 | Display reservations to authorized staff, by date | Not started | No route exists. `server/src/app.ts:81-82` mounts only availability and reservations. Plan `plan:32`, `plan:213`. | Correctly declared as not built. |
| FR6 | Update reservation status; authorized changes saved | Not started | No endpoint, no status mutation anywhere. Only writer of `Reservation` is `booking.ts:301`. Plan `plan:33`, `plan:214`. | Correctly declared. The plan under-specifies *which* transitions are legal; see 3.8. |
| FR7 | Show useful error messages; customer knows what to correct | Partial | Server side good: typed codes plus human messages (`validation.ts`), uniform envelope (`app.ts:21-23`), client renders them (`client/src/components/ErrorBanner.tsx:8-26`). Two gaps: (a) malformed JSON and >64kb bodies produce a generic 500 (`app.ts:59-62`, verified by probe); (b) the client validates silently - `BookingForm.tsx:46` sets `noValidate`, `:27-31` computes `canSubmit`, `:103` disables the button, and no message ever explains why. A user who types a 1-character name sees a dead button. | **Partial.** The plan marks this "Done" at `plan:20`. That is an overclaim. |
| FR8 | Support desktop and mobile screens; form works at both sizes | Partial | `client/src/styles.css:348-356` is the only breakpoint; layout otherwise uses `clamp()` and `auto-fit`/`auto-fill` grids (`:38,42,78,130,312`). Responsive intent is present. But there is no viewport test, no manual-test record, and the plan asserts "Done" at `plan:24` with no evidence. PRD matrix row 7 is untested. | **Partial.** Implemented in CSS, unverified per PRD's own test matrix. |
| US1 | Customer sees available slots | Implemented | `SlotPicker.tsx:37-71`; empty state at `:65-69`; unavailable slots rendered disabled at `:49`. Plan `plan:19`. | OK. |
| US2 | Customer reserves a table; reference issued; missing fields or conflicts rejected | Implemented | `booking.ts:241-334`; validation errors 400, conflicts 409. Plan `plan:21-22`. | OK. |
| US3 | Staff see daily reservations; unauthenticated users cannot | Not started | No endpoint, no middleware. Vacuously true that unauthenticated users cannot read bookings, because nobody can. Plan `plan:32`, `plan:213`, `plan:217`. | Correctly declared. |
| US4 | Staff update status; valid changes saved, **invalid transitions rejected** | Not started | No endpoint. Plan `plan:214`, `plan:217`. Critically, the plan never defines the transition matrix that "invalid transitions" is measured against. `BLOCKING_STATUSES` (`config/booking.ts:94`) is exported and read by nothing. | Not started, **and the plan is not ready to start it**. See 3.8. |
| Matrix 1 | Valid booking saved with confirmation | Implemented | `server/tests/booking.test.ts:32-76` (201, reference regex, 3 slot rows). Plan `plan:235`. | OK. |
| Matrix 2 | Same table overlapping time rejected | Implemented | `server/tests/booking.test.ts:208-223`; concurrency of windows verified by probe. Plan `plan:236`. | OK. |
| Matrix 3 | Two simultaneous bookings for final table, at most one succeeds | Implemented | `server/tests/concurrency.test.ts:20-71` (1 x 201, 4 x 409, no 5xx, exactly 3 slot rows). Negative control reproduced. Plan `plan:237-239`. | OK. Strongest part of the project. |
| Matrix 4 | Missing customer details produce validation error | Implemented | `server/tests/booking.test.ts:78-114`. Plan `plan:236`. | OK. |
| Matrix 5 | Unauthorized staff access denied | Not started | No auth, no staff route. Plan `plan:217` (planned test). | Correctly declared. |
| Matrix 6 | Valid staff status update saved and displayed | Not started | No endpoint. Plan `plan:217`. | Correctly declared. |
| Matrix 7 | Mobile layout, booking process usable | Not started | No test, no manual record, no method named. Plan mentions it only as part of a blanket item at `plan:222` ("Full test matrix from PRD section 9 green"), which names neither the row nor how to verify it. | **Gap.** Covered by a slogan, not a task. |
| NFR Usability | Simple, responsive interface on phone and desktop | Partial | Responsive CSS exists (`styles.css:348`). No criterion, no device testing, no accessibility pass recorded. Plan says "responsive" once at `plan:24`. | **Partial.** Plan treats it as a checkbox, not a requirement. |
| NFR Security | Staff-only access protected; passwords hashed; inputs validated | Partial | Passwords hashed with bcrypt cost 10 (`server/src/scripts/seed.ts:25,54`). Inputs validated (`validation.ts`). Staff-only access does not exist yet, so that clause is Not started. Body limit 64kb (`app.ts:75`), `x-powered-by` off (`app.ts:73`). No rate limit, no CORS policy (`app.ts:74` is bare `cors()`). Plan `plan:202-206`, `plan:211-212`. | **Partial.** Correctly scoped in the plan, but two hardening items are absent from it entirely (CORS, credential rotation). |
| NFR Reliability | No double booking, including concurrent requests | Implemented | Unique index (`TableSlot.ts:35`) plus test (`concurrency.test.ts`). Plan `plan:22`, `plan:88-100`. | OK for the stated requirement. **But nothing asserts at runtime that the index still exists**; see 4.4. The requirement is met only while an undocumented external condition holds. |
| NFR Performance | API responds within 2 seconds with demo data | **Missing from plan** | Never mentioned. `grep -niE "performance\|2 second\|latency"` over the plan returns nothing. No measurement, no test, no budget. Code does 2 queries per availability call (`booking.ts:155,169`) so it is probably fine, but "probably fine" is not a verification. | **Gap.** The PRD proposes a target; the plan ignores it. |
| NFR Maintainability | Clear frontend/backend modules, documented code | Implemented | Layer separation is genuinely clean: `config/booking.ts`, `lib/time.ts`, `lib/validation.ts`, `lib/http.ts`, `services/booking.ts`, `routes/*`, `models/*`, with heavy explanatory comments. Plan `plan:65-75` documents it accurately. | OK. Caveat: no lint, no formatter, no CI (verified: no `.github`, no eslint or prettier config, no such script in either `package.json`). Nothing mechanically enforces the documented structure. |
| NFR Privacy | Store only necessary contact data; avoid sensitive information in logs | **Missing from plan** | Never mentioned. `grep -niE "privacy\|pii\|redact"` returns nothing. Storage is minimal (`Reservation.ts:13-33`: name, optional email, phone). But logging leaks PII: `app.ts:59` logs the whole error object, and for a body-parser failure that object carries `body` (verified by probe: the log line contained the customer's name, phone and email verbatim). | **Gap, and an actual defect.** Both halves of the requirement are unmet in different ways: the plan is silent, and the code violates the logging clause. |

**Verdict counts (25 rows): Implemented 12, Partial 4, Not started 7, Missing from plan 2.**

---

## 2. Discrepancies between the plan and the code

### 2.1 `plan:69` - "All booking rules live here. Nothing hardcodes hours elsewhere." False.

`server/src/config/booking.ts` is indeed the config home, but hours are hardcoded in two more places:

- `server/src/services/booking.ts:118`: the literal message `` `Bookings are accepted from 11:00 until 20:30 (the restaurant closes at 22:00).` ``
- `client/src/App.tsx:184`: the literal `Open daily 11:00&nbsp;AM [U+2013 en dash] 10:00&nbsp;PM.` (that character is a real en dash in source; this is the one place the UI hardcodes the service window)

Changing `SERVICE_CLOSE_MINUTES` would leave the API error text and the page subtitle silently lying. The plan states the opposite of what is true, and it states it as an invariant that "matters for planning" (`plan:39-40`).

### 2.2 `plan:20` and `plan:169` - "400 with typed error codes", and the error list. Incomplete.

The plan lists the errors for `POST /api/reservations` as 400 with eight codes plus two 409s. Two reachable paths are not in that list and return **500**:

- Malformed JSON body -> `500 INTERNAL_ERROR` (verified by probe). `app.ts:41-56` special-cases only `ApiError` and Mongoose `ValidationError`; the `SyntaxError` from `express.json()` falls through to `app.ts:59-62`.
- Body over the 64kb limit -> `500 INTERNAL_ERROR` (verified by probe, `type: 'entity.too.large'`).

Both are client faults being reported as server faults, and neither produces a code the customer can act on. `plan:172` claims "Every error, without exception" follows the documented envelope; the envelope shape is uniform, but the plan presents that as sufficient and it is not.

Also missing from the documented contract: `INVALID_BODY` (`validation.ts:168`) and the 404 `NOT_FOUND` envelope (`app.ts:66`).

### 2.3 `plan:176` - "Stack traces and Mongo internals are logged server-side and never returned." True but misleading.

The response side is correct. The log side is presented as safe, and it is not: the same statement logs the request body. For a malformed booking, the log line contains the customer's name, phone and email (verified by probe). The plan documents logging as a mitigation for one risk (information leakage in responses) while itself creating a second risk (PII at rest in logs) that the plan never mentions.

### 2.4 `plan:49` - "`db.ts` calls `createIndex` at startup, so the database user needs index-creation rights." Accurate but incomplete in a way that changes the fix.

Mongoose `autoIndex` defaults to `true` (mongoose 8.24.8, `node_modules/mongoose/lib/connection.js:1038,1352`). I confirmed by probe that the unique index appears with **no** explicit call at all, purely from `TableSlot.ts:35`. So:

- The index is declared in **three** places: `models/TableSlot.ts:35`, `db.ts:15-18`, and `tests/setup.ts:19-21`. The plan mentions only `db.ts`.
- `db.ts:15-18` is redundant with schema auto-indexing, and its presence hides the fact that index creation is happening anyway, asynchronously, through a path with worse error reporting.
- The permission requirement is therefore broader than the plan states: any process that loads the models (including the seed script, via `db.ts:40`) needs index rights, not just the API boot.

### 2.5 `plan:191` - "`[ ] .env.example` documented for the team" is stale.

`server/.env.example` exists, is tracked (`git ls-files` confirms), and documents `MONGODB_URI` and `PORT`. The checkbox should be ticked. Small, but a teammate reading Sprint 0 would redo finished work.

### 2.6 `plan:207` - "Reservation reference collision handling under retry (currently relies on the unique index)". No retry exists.

`booking.ts:301-327`: on any `Reservation.create` failure, including a duplicate `reference`, the slot rows are deleted and the error is rethrown. There is no retry loop. A collision would surface as `500 INTERNAL_ERROR`. The plan's phrasing implies a retry mechanism that is not there. Severity is negligible in practice (`randomBytes` over a 32-character alphabet, 7 characters, `booking.ts:64-75`), but the wording is drift.

### 2.7 `plan:215` and `plan:219` - the Sprint 3 slot-release work does not say what it depends on.

`config/booking.ts:89-94` documents the invariant "a slot row exists if and only if the owning reservation is in a blocking status" and exports `BLOCKING_STATUSES`. Verified: nothing imports it. It is dead code today. The plan schedules the release behaviour but never says that `BLOCKING_STATUSES` is the intended single source of truth for it, nor that the constant is currently unread. A developer picking up Sprint 3 from the plan alone will hardcode `'CONFIRMED'` and `'SEATED'` in the staff service and re-create the drift.

### 2.8 `plan:70` - "`lib/time.ts` | The only place that converts local wall clock to UTC." Server-scoped, and the plan does not say so.

`lib/time.ts:79-82` is the only server conversion. But the client does the inverse conversion independently, in three places: `App.tsx:23-30`, `App.tsx:37-44`, `SlotPicker.tsx:12-19`, plus `Confirmation.tsx:9-33`. That is correct layering (the browser must format), but the plan presents a one-sided invariant while the client re-derives dates from the **browser's** clock at `App.tsx:15-20`. See 4.6 for the resulting bug.

### 2.9 `plan:277` - "Seed staff credentials are `staff` / `password123`". Wrong credential.

The literal at `server/src/scripts/seed.ts:23-24` is a hardcoded 9-character string that is **not** `password123` (verified programmatically; the string also contains digits, upper and lower case). `password123` appears nowhere in the repository except this one line of the plan. Anyone following section 9 of the plan cannot log in. This is the most user-visible inaccuracy in the document, and it will surface during the demo.

### 2.10 Claims that are accurate (stated for completeness, not as findings)

`plan:22`, `plan:25`, `plan:42-48`, `plan:117-123`, `plan:125`, `plan:151`, `plan:190`, `plan:199`, `plan:231`, `plan:235-237`, `plan:239`, `plan:252-253` all check out against source. The plan's self-description as "verified against commit `0b7a504`, not from memory" (`plan:13`) is credible: the errors I found are omissions and drift, not fabrication.

---

## 3. Discrepancies between the plan and the PRD

### 3.1 Service hours 11:00-22:00 and 30-minute increment - approved deviation, correctly recorded

PRD section 5 leaves both unspecified. The plan records them as "team decision 2026-11-03" (`plan:116`, `plan:118`). Correct handling. No finding.

### 3.2 90-minute duration - implemented, but the PRD marks it unapproved, and the plan presents it as settled

PRD section 5: "Proposed booking duration: 90 minutes, with no buffer (**not yet approved**)." The plan's rules table lists it with source "PRD section 5" (`plan:117`) as though the PRD settled it. It did not; the PRD proposed it. **Undocumented status change.** The code depends on it structurally (`BOOKING_DURATION_MINUTES` drives `SLOTS_PER_BOOKING`, which drives the 3-row write), so it is now expensive to change. It needs an explicit approval record, not a citation to a proposal.

### 3.3 Blocking statuses CONFIRMED + SEATED - same problem

PRD section 5: "Only CONFIRMED and SEATED would block availability; **the team must approve this rule**." The plan cites PRD section 5 as the source (`plan:121-122`). **Undocumented status change.** Low immediate risk because the rule is unenforced (see 2.7), but Sprint 3 will encode it.

### 3.4 A fourth collection (`tableSlots`) not in the PRD's data design - justified, but the consequence is under-documented

PRD section 8 lists exactly three collections: `tables`, `reservations`, `staffUsers`. The code adds `tableSlots` (`models/TableSlot.ts`). This is the right call: the PRD's `reservations` schema (table, start, end, status) implies a range-overlap check, which cannot be made race-free without a transaction or a unique constraint, and MongoDB has no range-exclusion constraint. The plan argues this well (`plan:88-100`), rejecting transactions, an in-process mutex, and a lock collection, each with a stated cost.

What the plan does not say is that this buys correctness at the price of a **dual source of truth**: `tableSlots` must always equal the union of the windows of blocking reservations, and nothing enforces or checks that equality. Every risk in section 4 of this review follows from that sentence. The PRD-level divergence is justified; the architectural consequence is the part the plan omits.

### 3.5 `staffUsers` lacks an email field - undocumented minor divergence

PRD section 8 specifies "Staff ID, username/email, password hash, role". `models/StaffUser.ts:6-24` has `username` only, no email. Harmless for the MVP (the PRD's slash is ambiguous), but it is a silent narrowing of the data model.

### 3.6 FR1's "by time" is not accepted as a parameter - justified, undocumented as a divergence

FR1 says "Check availability by date, time, and party size". `routes/availability.ts:16-44` accepts `date` and `partySize` only and returns all 20 slots. This is a superset of what FR1 asks for from the customer's point of view, so I would not change it, but the plan never notes that the API shape differs from FR1's wording.

### 3.7 PRD section 10 sprint numbering has been renumbered without acknowledgement - traceability hazard

PRD: Sprint 1 = React pages, Express setup, Mongo models; Sprint 2 = availability, booking creation, conflict prevention.
Plan: Sprint 1 = models + availability + booking + React + seed + 16 tests, all done (`plan:193-199`); Sprint 2 = "hardening", an activity the PRD never schedules (`plan:201-207`).

The plan has delivered PRD Sprints 1 and 2 at `v0.2.0` and repurposed Sprint 2. This is a defensible re-sequencing (a vertical slice without conflict prevention would be incoherent), but it is **undocumented**, and because the plan reuses the PRD's sprint numbers, a reader cannot tell whether the project is ahead of, on, or behind the PRD's schedule. Given the PRD is a graded SDLC artifact, that is a real cost.

### 3.8 US4's "invalid transitions are rejected" has no definition anywhere - genuine gap

US4's acceptance criteria require invalid transitions to be rejected. The plan schedules a test for it (`plan:217`, `plan:244`) but never defines the legal transition set. `RESERVATION_STATUSES` (`config/booking.ts:79-85`) is an enum with no edges. Without a matrix, "invalid transition" is undefined and the test cannot be written. Is `CANCELLED -> SEATED` legal? Is `COMPLETED -> CANCELLED`? Is any transition out of `CANCELLED` legal? Nobody has decided. This blocks Sprint 3, not just the test.

### 3.9 PRD Definition of Done requires PR review; the plan never mentions it - genuine gap

PRD section 9: "code reviewed through GitHub pull request". The plan's Sprint 0 covers CI (`plan:190`) but not review, and the repository has a single squashed feature commit with no PR history. **Genuine gap** against an explicit completion criterion.

### 3.10 Mandatory contact fields are an open PRD decision that the code has already made

PRD section 11 lists "mandatory contact fields" as needing confirmation. The plan correctly lists it as still open (`plan:258`). But the code already implements a decision: name and phone required, email optional (`validation.ts:142-163`, `BookingForm.tsx:88-101`). An open decision is baked into a shipped API contract. Either the decision gets made or the plan should note that the current shape is provisional.

### 3.11 Privacy and performance: PRD requirements with no plan coverage at all

Covered in the matrix. Recorded here because they are PRD section 7 items, not implementation details: the plan is entirely silent on both, and the privacy requirement is actively violated by `app.ts:59`.

---

## 4. Architectural risks not captured in the plan

The plan's risk table (`plan:250-256`) has five rows. Two are not engineering risks (no Atlas cluster, unnamed BA/PM/QA). Of the three that are, one is addressed correctly (Atlas index rights) and one names the wrong failure (orphaned slots "on status change"). The following are missing.

### 4.1 The single-writer invariant is documented, not enforced. Sprint 3 will break it.

`plan:80` states: "`services/booking.ts` is the sole writer of `tableSlots`." Today that is true: verified by grep, the only write sites in `src` are `booking.ts:289, 292, 296, 325`, and only `booking.ts:33` imports the model.

It is true **by accident**, not by construction. There is no module boundary, no lint rule, no CI, and no type-level barrier. `TableSlot` is a plain exported Mongoose model; any file can import it and call `deleteMany`. Verified: no eslint or prettier configuration exists anywhere in the repo, and neither `package.json` has a lint script, so the plan's own proposed mitigation ("single-writer rule in section 2") is a comment in a Markdown file.

Now consider Sprint 3. A `PATCH /api/staff/reservations/:id/status` handler must, on a transition to a non-blocking status, delete that reservation's slot rows. The natural implementation is a new `services/staff.ts` or a handler in `routes/staff.ts` calling `TableSlot.deleteMany({ reservationId })`. That is a one-line change that silently violates the invariant, passes every existing test, and produces the exact bug the plan warns about at `plan:219` ("the bug is invisible until a customer cannot book a table that looks empty on the dashboard").

The plan's mitigation is one scenario test (`plan:217`, "cancelling frees the slot"). A scenario test covers the path the author thought of. What is needed instead is:

1. **A structural boundary.** Extract slot mutation into a module that owns the collection (`lib/slots.ts` or `services/slots.ts`) exporting exactly `reserveWindow()` and `releaseWindow()`. Make it the only importer of `TableSlot`. Enforce with `no-restricted-imports` (or dependency-cruiser) so a violation fails the build rather than the demo.
2. **An invariant test, not a scenario test.** Assert the cross-collection property directly: for every `CONFIRMED` or `SEATED` reservation, exactly `SLOTS_PER_BOOKING` rows exist for its window and table; for every other status, zero rows exist. This is one query pair and it catches cancel, complete, no-show, and any future status added without wiring, all at once. It also catches the orphan case in 4.2. This test is strictly more valuable than the four tests listed at `plan:217`.

Also note: `BLOCKING_STATUSES` (`config/booking.ts:94`) should be the single source for "does this status hold capacity", and it is currently unread. Sprint 3 must consume it rather than re-enumerate the statuses.

### 4.2 Crash between the two writes leaves a permanently blocked table with no reservation to explain it

Order of operations in `createReservation`: slot rows are secured at `booking.ts:289`, then the reservation document is written at `booking.ts:301`.

If the process dies between those two statements, three slot rows exist whose `reservationId` refers to a reservation that was never written. There is no recovery:

- The `catch` at `booking.ts:323-327` that would release them never runs; the process is gone.
- There is no reconciler, sweep, or startup repair anywhere in the repository (verified by grep for `deleteMany` on `TableSlot`: only the three in-request paths at `:292, 296, 325`).
- `getAvailability` reads only `tableSlots` (`booking.ts:169`), so the table reports `available: false` forever.
- There is no reservation row, so the staff dashboard (Sprint 3) cannot show or cancel it.
- Nothing is logged, because nothing threw.

The result is a table that is unbookable for one 90-minute window, permanently, with no operator-visible cause. The plan's risk table covers "slot rows orphaned on status change" (`plan:254`), which is a different and far more visible failure: that one has a reservation row to act on.

Window of exposure: the gap is short (two awaits), but deploys, OOM kills, and `SIGKILL` during a restart all land inside it, and the failure is silent and cumulative. Note that `index.ts:27-41` installs a graceful `SIGTERM` handler, which reduces but does not eliminate this: a handler calling `server.close()` does not wait for in-flight request bodies to finish their database work, and `SIGKILL` bypasses it entirely.

Is the existing cleanup sufficient? No. It is sufficient for the *concurrent* failure (duplicate key, `booking.ts:290-298`) and for the *rejected write* failure (`booking.ts:323-327`). It is not sufficient for process death.

Options, cheapest first:

1. **A reconciler.** Delete slot rows whose `reservationId` has no matching reservation. About 10 lines; can run at startup and on an interval. This is the minimum and it also mops up any other orphan path discovered later.
2. **Invert the write order.** Create the reservation first with a non-blocking `PENDING` status, then write slots, then flip to `CONFIRMED`. An orphaned `PENDING` reservation is visible to staff and harmless, and can be expired by a timestamp sweep. Cost: one extra update, and `PENDING` is not in the PRD's status list, so it needs approval (PRD section 5 is explicit that the status set is unapproved).
3. **A transaction.** Correct, and the plan rejects it at `plan:94` on the grounds that it "requires a replica set". That reasoning is sound for the deployment (Atlas M0 is a replica set, so it would work in production). But the plan should record the consequence it does not mention: `mongodb-memory-server` here is a **standalone** server, and transactions fail on it (verified by probe: "Transaction numbers are only allowed on a replica set member or mongos"). Adopting transactions would therefore break the entire test suite unless `tests/setup.ts:13` is switched to `MongoMemoryReplSet`. A future developer reading `plan:94` and deciding "let us just use a transaction" will hit this wall with no warning.

Recommendation: take option 1 now (it is cheap and unconditional), and record option 2 as the Sprint 3+ design if `PENDING` is approved.

### 4.3 `db.ts` index creation: the failure is fail-closed (good) but the mechanism is duplicated and the error is confusing

`db.ts:15-18` calls `createIndex({ tableId, slotStart }, { unique: true })` before the server listens. If it throws, `connectToDatabase` rejects, `index.ts:44-47` catches, sets `process.exitCode = 1`, and the API never accepts traffic. That is the correct posture: refuse to serve rather than serve without the correctness guard. The plan's risk row (`plan:252`) gets the impact right.

What it misses:

- **`autoIndex` is still on.** Mongoose creates the same index from `TableSlot.ts:35` regardless of `db.ts` (verified by probe). So on a restricted Atlas user, the failure may not come through the tidy `connectToDatabase` path at all; it can arrive asynchronously as a rejected `Model.init()`. Whether that surfaces as a clean startup failure or an unhandled rejection depends on timing. Either way, "move index creation to a migration step" (`plan:252`) does **not** remove the dependency unless `autoIndex: false` is also set in the `mongoose.connect` options. The plan's mitigation is incomplete as written.
- **A name collision produces error code 86 with an unhelpful message.** If an index named `tableId_1_slotStart_1` already exists with different options (created by hand, or by an older schema version), `createIndex` throws "An existing index has the same name as the requested index" (verified by probe). Startup dies with a message that says nothing about uniqueness. Worse, if the pre-existing index is **non-unique**, the application is one restart away from silently double-booking, and the only signal is a boot failure whose text does not mention it.
- **The index is declared three times** (`TableSlot.ts:35`, `db.ts:15-18`, `tests/setup.ts:19-21`) with no single source of truth. The schema declaration is the only one that survives a `syncIndexes()`; the `db.ts` one is the only one that fails loudly. That asymmetry is undocumented.

Correct fix, in one place:

1. Set `autoIndex: false` in `connectToDatabase` (`db.ts:11`) so index creation is explicit and singular.
2. Keep exactly one creation step (schema declaration plus a bootstrap/migration, or `db.ts` alone, but not both).
3. **Assert, do not assume.** After connecting, read `collection.indexes()` and verify that `{tableId: 1, slotStart: 1}` exists **with `unique: true`**. If it does not, throw with a message naming the double-booking risk. This converts a silent correctness failure into a loud startup failure, which is the whole point.

### 4.4 If the unique index disappears, the system double-books silently and every test still passes

This is the highest-severity item in the review, and the plan does not contain it.

I verified the failure mode directly: after `dropIndex('tableId_1_slotStart_1')`, five identical parallel bookings all returned **201**, wrote **15 slot rows**, and produced **5 reservations for one table at one time**. No error was raised, nothing was logged, and the API behaved as though everything was fine.

Ways the index can disappear:

- A developer debugging contention drops it, and does not recreate it. `db.ts:15-18` would recreate it on the next boot, but only if it boots (see 4.3), and only in an environment where that code runs.
- Someone removes `TableSlot.ts:35` while leaving `db.ts:15-18`, then a future `TableSlot.syncIndexes()` drops the index because the schema no longer declares it. `syncIndexes` removes indexes that are not in the schema; it does not know about `db.ts`.
- A database restore from a dump taken without indexes.
- A fresh database created by a tool path that never runs `connectToDatabase`.

The plan's entire defence is a code comment (`TableSlot.ts:9-10`, "DO NOT REMOVE THIS INDEX") and a test that runs only when a human types `npm test`. There is no CI (verified: no `.github/workflows`), so in practice the concurrency test runs when someone remembers.

Given that FR4 and the Reliability NFR are the PRD's only hard correctness requirements, and that this is the only mechanism satisfying them, the guard deserves a runtime check, not a comment. The startup assertion in 4.3 plus CI (`plan:190`, still unchecked) closes this. Until then, the project's central claim ("no double booking") rests on an unverified environmental condition.

### 4.5 Rate limiting: the plan's one unchecked line conflates two different problems, and only one of them is about load

`plan:206` lists "Rate limiting on `POST /api/reservations`" as an unchecked Sprint 2 item. Verified: no `express-rate-limit`, no throttling, no auth, no hold, no per-contact cap anywhere.

Cost per request is not trivial: up to `MAX_CANDIDATE_ATTEMPTS` = 25 attempts (`config/booking.ts:49`), each an `insertMany` of 3 documents plus a `deleteMany` on failure (`booking.ts:273-298`). Under contention that is up to 75 writes plus 25 deletes for one HTTP request.

But the more interesting exposure is not load, it is **inventory**:

- `POST /api/reservations` is public and unauthenticated.
- `booking.test.ts:174-206` proves that six requests (party of 1, same time) consume all six tables at that time, and the seventh gets `BOOKING_CONFLICT`.
- There is no hold, no expiry, no per-phone or per-email daily cap, and no verification that the contact details belong to anyone.
- There is no customer cancellation in the MVP (PRD section 5), so nothing self-heals. Only staff action can free the inventory, and staff tooling does not exist yet.

So a script can zero out an entire day's availability in seconds, and nobody can undo it until Sprint 3 ships. That is a data-integrity and business-continuity risk, not a throughput risk, and rate limiting alone does not fix it: an attacker within the rate limit still books all six tables.

The plan should therefore split the item: (a) abuse/DoS, mitigated by `express-rate-limit` on POST and a cache or throttle on the unauthenticated availability GET (`booking.ts:155,169`, two queries per call, no cache); (b) inventory squatting, which needs the Sprint 3 staff tooling to release stale bookings and is not solvable by throttling. Naming (b) as an accepted risk for the demo is a legitimate choice. Leaving it as an unchecked checkbox is not, because it implies the risk is unconsidered rather than accepted.

### 4.6 The client and the server disagree about what "today" means

`App.tsx:15-20` (`todayLocalIso`) derives the default booking date and the `min` attribute (`App.tsx:206`) from the **browser's** clock. `routes/availability.ts:34` rejects any date earlier than `todayInRestaurantTimezone()` (`lib/time.ts:69-71`), which is the **restaurant's** today.

For a customer west of Toronto (for example Hawaii, UTC-10, in the evening), the browser's today is still the previous calendar day while the restaurant has already rolled over. The page loads with a default date the server considers past, and the very first availability request returns `400 DATE_IN_PAST`. The customer sees an error before doing anything. For a customer far east the inverse occurs: the default date is one the restaurant considers tomorrow.

The plan's section 3.2 argues that `lib/time.ts` is "the sole timezone boundary" and that mixing wall-clock and instants "reintroduces DST bugs". The client does exactly that mixing, using the browser zone, and the plan does not mention it. Fix is small: the availability response already carries `timezone` (`booking.ts:218`); add a `today` field, or default the date input from the server on first load.

### 4.7 CORS and the Sprint 3 auth decision are coupled, and the plan decides neither

`app.ts:74` is a bare `cors()`, which reflects any origin and does not support credentials. For a public booking API that is acceptable today. The plan's Sprint 3 list (`plan:210-216`) proposes adding `cookie-parser` alongside `jsonwebtoken`, which implies cookie-based sessions. Those two choices conflict:

- Cookie auth from a different origin requires `cors({ origin: <specific>, credentials: true })`. The current bare `cors()` will not work, and the naive fix (`credentials: true` with a reflected origin) is rejected by browsers.
- Token-in-`Authorization`-header auth works with the current CORS setup unchanged.

The plan should choose now, because it determines whether Sprint 3 touches `app.ts` and how the staff UI is built. It also determines the CSRF story: cookie auth with `SameSite=None` needs CSRF protection that the plan does not budget for.

Related Sprint 3 details the plan under-specifies:

- `StaffUser.passwordHash` is `select: false` (`models/StaffUser.ts:17`). The login query must explicitly `.select('+passwordHash')`; forgetting it yields `undefined` and a confusing failure. Worth one line in the plan.
- `plan:211` says "bcrypt comparison, constant-time". `bcrypt.compare` is not constant-time with respect to input length, and constant-time comparison is not the real requirement. The real requirements are (a) return an identical error for unknown user and wrong password, and (b) hash a dummy value when the user does not exist, so response timing does not enumerate accounts. As written, the plan's phrasing will lead an implementer to the wrong technique.
- The seeded credential is a **hardcoded literal in a tracked source file** (`seed.ts:23-24`) with no environment override. Sprint 4 includes "Deploy" (`plan:224`) but no credential rotation. A deployed instance would ship a known password.

### 4.8 Minor: `MAX_CANDIDATE_ATTEMPTS` exhaustion reports the wrong error

`booking.ts:274-276` breaks out of the candidate loop on the cap, then falls through to `BOOKING_CONFLICT` at `:330` ("That time slot was just taken"). With six tables and a cap of 25 (`config/booking.ts:49`) this is unreachable. If the restaurant ever exceeds 25 fitting tables, the API would tell customers a slot was taken when the real cause was internal exhaustion. The plan calls the constant "a safety valve above the table count" (`plan:47`) without noting the misreporting. Low severity, but the fall-through should distinguish the two causes.

---

## 5. Plan quality assessment

**Is it an implementation guide or documentation of what was built?** Both, weighted toward documentation. Roughly 60 percent of the document (sections 1, 2, 4, 5, and parts of 7) describes existing code; roughly 40 percent (sections 3, 6, 8) guides future work. That is not a defect for a living document at `v0.2.0`, but it means the plan cannot yet be handed to a developer for Sprint 3 without supplementing it.

**Load-bearing sections** (a teammate genuinely needs these):

- **Section 2, layer table and the two invariants (`plan:65-80`).** The best part of the document. It tells a newcomer where a rule belongs and why, and it names the two invariants that matter. Two of the three inaccuracies I found (2.1, 2.8) are in this table, which is a sign of how much weight it carries.
- **Section 3.1, conflict prevention (`plan:88-100`).** Genuinely good architectural writing: the problem, the decision, three rejected alternatives each with a stated cost, and the non-obvious detail that `{ ordered: false }` makes the cleanup load-bearing. This is the section that makes the design reproducible.
- **Section 4, booking rules with sources (`plan:114-123`).** The provenance column is exactly right. It is also where the two unapproved PRD rules are mislabelled as approved (3.2, 3.3).
- **Section 5, API contract (`plan:129-179`).** Accurate on the happy paths, incomplete on the error paths (2.2).
- **Section 6, Sprint 3 checklist (`plan:209-219`).** Actionable, and the ordering is right (auth before the dashboard). Under-specified on the two hardest parts: the transition matrix and the slot release mechanism.
- **Section 7, test strategy (`plan:229-244`).** Honest about why the database is not mocked, and the negative-control note is the single most credible sentence in the document.

**Filler or drifting:**

- **Sections 1.1 and 1.2** duplicate section 4 and section 6. Three places now assert overlapping facts, and they have already diverged (2.5).
- **Section 9, "How to run" (`plan:262-277`)** duplicates a 225-line README, and it is the section that contains the wrong credential (2.9). A plan should link to the README, not fork it.
- **Section 8, risk table (`plan:250-256`).** Five rows, two of which are team-admin items, and one of which names the wrong failure mode (4.2). The genuinely dangerous risks (4.1, 4.4) are absent.

**What is missing to make it an implementation guide:** no schema diagram or field-level data model; no status-transition matrix (blocks US4); no error-code reference table (it is prose, and incomplete); no auth design (mechanism, token storage, expiry, CSRF); no index/migration strategy; no definition of done per sprint tied to PRD section 9; no performance budget; no privacy statement.

**Is the sprint breakdown realistic against the PRD's Sprint 0-4 table?** Two observations.

First, the plan has **compressed the PRD's Sprints 1 and 2 into one** and repurposed Sprint 2 as "hardening" (3.7). As engineering this is fine and arguably better than the PRD's sequencing. As project tracking it is a problem: the plan's sprint numbers no longer map to the PRD's, so the PRD's own schedule table cannot be used to judge progress. The plan should state the mapping explicitly, for example "PRD S1 and S2 delivered at `v0.2.0`; plan Sprint 2 is unplanned hardening".

Second, **Sprint 3 as written is the least realistic item in the document.** It bundles: two new dependencies, login endpoint, `requireStaff` middleware, two new endpoints, status-transition validation, the slot-release mechanism (the highest-risk change in the project, by the plan's own admission at `plan:219`), a staff login page, a dashboard, status controls, and four tests. Auth from scratch and mutation of the slot table are independent risks that share no code; putting them in one sprint means a slip in either hides the other. Sprint 4 (`plan:221-225`) then has zero slack: full matrix, docs, deploy, and demo, with matrix row 7 (mobile) still unowned and unmethoded.

Recommendation: split Sprint 3 into 3a (auth plus a read-only date-filtered dashboard; additive, low risk, delivers FR5 and US3) and 3b (status transitions, slot release, invariant test; mutating, high risk, delivers FR6 and US4). Ship 3a first so that if 3b slips, the demo still has a working staff view rather than a half-built auth flow and no dashboard.

---

## 6. Prioritized recommendations

### Must fix before Sprint 3

**1. Assert the unique index at startup, and make index management single-source.**
Change: in `db.ts`, set `autoIndex: false` on connect, and after connecting read `collection('tableSlots').indexes()` and throw unless `{tableId: 1, slotStart: 1}` exists with `unique: true`. Remove the duplicate creation at `db.ts:15-18` or the schema declaration at `TableSlot.ts:35`, but not both, and document which is authoritative.
Why: the index is the only thing preventing double booking, and nothing verifies it exists (4.4, verified: 5 of 5 concurrent bookings succeed once it is dropped). The current guard is a comment and a test that only runs locally.
Serves: FR4, Reliability NFR.

**2. Define the status-transition matrix, and make `BLOCKING_STATUSES` the single source.**
Change: add an explicit transition table to the plan (from, to, allowed) covering all five statuses, decide whether any transition out of `CANCELLED` or `COMPLETED` is legal, and specify that capacity release is driven by `BLOCKING_STATUSES` (`config/booking.ts:94`), which is currently dead code.
Why: US4 requires invalid transitions to be rejected, and "invalid" is undefined. `plan:217` schedules a test that cannot be written until this exists.
Serves: FR6, US4.

**3. Enforce the single-writer invariant structurally, and replace the scenario test with an invariant test.**
Change: extract slot mutation into one module exporting `reserveWindow()` and `releaseWindow()`; make it the only importer of `TableSlot`; enforce with a lint rule. Add a test asserting that slot rows exist if and only if the owning reservation is in a blocking status, with the correct count.
Why: the invariant at `plan:80` is currently true by accident, and Sprint 3's most natural implementation breaks it silently while passing every existing test (4.1). The invariant test also catches 4.2's orphans.
Serves: FR4, FR6, Reliability NFR.

**4. Add a reconciler for orphaned slot rows.**
Change: at startup and on an interval, delete `tableSlots` rows whose `reservationId` has no matching reservation. Record inverting the write order (reservation first with `PENDING`, then slots) as the alternative if `PENDING` is approved.
Why: a crash between `booking.ts:289` and `booking.ts:301` leaves a table blocked forever with no reservation row, no log, and no way for staff to see or fix it (4.2).
Serves: Reliability NFR, FR4.

**5. Stop logging PII, and map client-caused parse failures to 400.**
Change: in `app.ts:59`, log the error's `name`, `status` and `type` only, never the object (which carries `body` for body-parser failures). Add explicit handling for `entity.parse.failed` and `entity.too.large` to return `400` with a typed code instead of `500`.
Why: verified - a malformed booking logs the customer's name, phone and email verbatim, directly violating the Privacy NFR's "avoid sensitive information in logs". The 500s also break FR7's "customer knows what to correct" and contradict `plan:20`'s "400 with typed error codes".
Serves: Privacy NFR, FR7.

### Should fix before the final demo

**6. Add CI running `npm test` and `npm run typecheck` on push.**
Why: it is the only thing that keeps the concurrency guard honest once there is no human running the suite, and it is already an unchecked Sprint 0 item (`plan:190`). Without it, recommendation 1's assertion only fires when someone deploys.
Serves: Reliability NFR, PRD Definition of Done.

**7. Add rate limiting, and name inventory squatting as a separately accepted risk.**
Change: `express-rate-limit` on `POST /api/reservations`, plus a cache or throttle on the unauthenticated availability GET. Separately, document in the plan that six requests can exhaust a day's inventory (`booking.test.ts:174-206` proves it), that there is no hold or expiry, and that only Sprint 3 staff tooling can release it.
Why: the plan's single checkbox (`plan:206`) conflates DoS with a business-integrity hole that rate limiting does not close.
Serves: Security NFR, FR4.

**8. Fix the client/server "today" mismatch.**
Change: return `today` (restaurant-local) in the availability payload, and default the date input from it rather than from the browser clock at `App.tsx:15-20`.
Why: a customer west of Toronto gets `400 DATE_IN_PAST` on first page load, before interacting (4.6). This also contradicts the plan's own "sole timezone boundary" claim.
Serves: FR1, US1, Usability NFR.

**9. Correct the plan's factual errors.**
Change: `plan:277` seed credential (wrong, and the real one is a hardcoded literal in `seed.ts:23-24`), `plan:191` `.env.example` (already done and tracked), `plan:69` "nothing hardcodes hours elsewhere" (contradicted by `booking.ts:118` and `App.tsx:184`), `plan:20` "400 with typed error codes" (two paths return 500), `plan:176` logging claim (logs contain PII), `plan:207` "under retry" (no retry exists).
Why: a plan whose stated facts are wrong is worse than no plan, because it is trusted. `plan:277` in particular will fail during the demo.
Serves: Maintainability NFR.

**10. Record the two unapproved PRD rules as open decisions.**
Change: mark the 90-minute duration and the CONFIRMED/SEATED blocking rule as "proposed by PRD, implemented, awaiting team approval", not "source: PRD section 5". Add a decision log with dates alongside the 2026-11-03 entries.
Why: the PRD explicitly flags both as unapproved (section 5), and both are now structurally baked into the code.
Serves: PRD section 5, section 11.

**11. Define per-sprint done against PRD section 9, and assign the mobile test.**
Change: add a per-sprint done checklist mirroring PRD section 9 (PR review, tests pass, no critical booking/security issue, docs updated). Assign matrix row 7 (mobile) an owner and a method; `plan:222`'s blanket "full matrix green" is not a task.
Why: the PRD's Definition of Done requires PR review, which the plan never mentions (3.9), and row 7 has no verification method anywhere.
Serves: PRD section 9, FR8, Usability NFR.

**12. Measure the 2-second performance target.**
Change: add a smoke measurement against seeded data, and record the number.
Why: the plan is entirely silent on the Performance NFR (verified by grep). The current design is likely fast (two indexed queries per availability call), but "likely" is not evidence for a graded requirement.
Serves: Performance NFR.

### Nice to have

**13. Add lint and format tooling.**
Why: there is none (verified), which is what makes recommendations 3 and 9 unenforceable. A single eslint config with `no-restricted-imports` is the cheapest way to make the single-writer invariant mechanical.

**14. Document `tableSlots` as a deliberate departure from PRD section 8's data model.**
Why: the PRD lists three collections; the implementation has four. The plan justifies the design (well, at `plan:88-100`) but never says it departs from the PRD's data design or that the cost is a dual source of truth requiring reconciliation (3.4).

**15. Choose the Sprint 3 auth mechanism now, and fix the CORS implication.**
Why: `plan:210` proposes `cookie-parser`, which is incompatible with the current bare `cors()` (`app.ts:74`). Decide token-in-header versus cookie before Sprint 3 starts, and note that `passwordHash` is `select: false` (`StaffUser.ts:17`) so the login query must opt in (4.7).

**16. Fix `MAX_CANDIDATE_ATTEMPTS` fall-through.**
Why: exhaustion reports `BOOKING_CONFLICT` ("that time slot was just taken") rather than an internal condition (`booking.ts:274-330`). Unreachable today with six tables; misleading if the restaurant grows (4.8).

**17. Move the seeded staff credential to an environment variable.**
Why: it is a hardcoded literal in a tracked file (`seed.ts:23-24`) and Sprint 4 includes deploying (`plan:224`) with no rotation step (4.7).

---

## 7. Summary judgement

The plan is **substantially accurate about what exists** and **genuinely good on the one hard design decision** (conflict prevention). Its numbers check out; its negative-control claim reproduces; its environment claims are true. It is not a document written from memory.

Its weaknesses are three:

1. **It documents invariants it does not enforce.** The single-writer rule and the unique index are both stated as facts and both rest on nothing but discipline and a locally-run test. Sprint 3 is precisely the change that breaks the first, and there is no CI to catch the second.
2. **It is silent on two PRD section 7 requirements** (performance, privacy), and the privacy silence coincides with an actual PII leak in `app.ts:59`.
3. **It is not yet ready to drive Sprint 3.** The transition matrix (US4) is undefined, the auth mechanism is undecided, and the slot-release mechanism, which the plan itself calls the thing that matters, has no design.

Fix recommendations 1 through 5 before Sprint 3 starts. They are small changes to a sound design, and each one converts a documented intention into a checked property.
