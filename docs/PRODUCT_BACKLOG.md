# Product Backlog: Restaurant Table Reservation Management System

| Field | Value |
| --- | --- |
| Project | Web-Based Restaurant Table Reservation Management System |
| Methodology | Agile / Scrum |
| Document owner | Business Analyst / Project Manager |
| Version | 1.0, draft for team review |
| Updated | November 4, 2026 |
| Source | Team PRD and the repository README (Sprint 1 vertical slice) |

## 1. Product Goal

Develop a simple web application for one restaurant that lets customers check table
availability and make reservations online, while restaurant staff can manage bookings
through a secure dashboard.

The minimum viable product (MVP) focuses on reliable reservations and staff management.
Online payments, SMS notifications, AI recommendations, and multi-restaurant support are
out of scope.

## 2. Backlog Conventions

- **Priority:** Must / Should / Could (MoSCoW).
- **Status:** Implemented (documented in README), Planned, To verify, or Proposed.
- **Sprint:** Sprint 1 and Sprint 3 assignments are taken from the README. Other sprint
  assignments require team agreement.
- **Ownership:** BA/PM maintains requirements and backlog; Developer Lead owns technical
  implementation; QA owns test execution and defect tracking. Individual task
  assignments require team confirmation.
- **Definition of Done (proposed):** Acceptance criteria met; relevant tests pass;
  changes reviewed through a pull request; documentation updated; no unresolved critical
  defects.

## 3. Prioritized Product Backlog

| ID | User story / deliverable | Priority | Status | Sprint / notes |
| --- | --- | --- | --- | --- |
| US-01 | View table availability for a selected date and party size | Must | Implemented (README) | Sprint 1 |
| US-02 | Make a table reservation with contact details | Must | Implemented (README) | Sprint 1 |
| US-03 | Prevent overlapping bookings for the same table and time | Must | Implemented (README) | Sprint 1 |
| US-04 | Assign the smallest suitable available table | Must | Implemented (README) | Sprint 1 |
| US-05 | Staff sign in securely | Must | Planned | Sprint 3 (README) |
| US-06 | Staff view upcoming and current reservations | Must | Planned | Sprint 3 (README) |
| US-07 | Staff update booking status (seated, completed, no-show) | Must | Planned | Sprint 3 (README); confirm exact workflow |
| US-08 | Staff cancel a reservation and release occupied slots | Should | Planned | Sprint 3 (README); confirm permissions and rules |
| US-09 | Customer receives clear on-screen booking confirmation | Must | To verify | Confirm UI behavior against PRD |
| US-10 | Customer interface works on desktop and mobile | Should | To verify | Confirm responsive behavior |
| QA-01 | Verify availability, booking, validation, and conflict scenarios | Must | Partially implemented | Existing automated tests; QA review pending |
| QA-02 | Verify staff workflows and end-to-end acceptance criteria | Must | Planned | After staff features |
| DOC-01 | Maintain PRD, backlog, and user stories | Must | In progress | BA/PM |
| DOC-02 | Record weekly progress, risks, and decisions | Must | Proposed | BA/PM; team to confirm reporting format |

> **Status note:** "Implemented" means described as working in the README, not
> independently accepted by QA. The README states that staff authentication, seating,
> and cancellations are planned for Sprint 3.

## 4. Core User Stories and Acceptance Criteria

### US-01: View Availability

> As a customer, I want to see available reservation times for my date and party size,
> so that I can choose a suitable time.

**Acceptance criteria**

1. Given a valid upcoming date and party size, when I request availability, then the
   system returns the bookable start times and their availability status.
2. Given an invalid or past date, when I request availability, then the system displays
   a clear validation error.
3. Given a time with no suitable free table, when I view results, then that time is
   marked unavailable.

*Current documented behavior:* 20 start times daily, 11:00 to 20:30, in 30-minute
increments; party size 1 to 20; America/Toronto timezone.

### US-02: Make a Reservation

> As a customer, I want to book an available table using my contact information, so that
> my reservation is confirmed.

**Acceptance criteria**

1. Given valid customer details and an available time, when I submit the booking, then
   the system creates a CONFIRMED reservation and returns a reference number.
2. Given missing or invalid required details, when I submit the booking, then the system
   rejects it with a useful error.
3. Given a booking time in the past or outside allowed start times, when I submit the
   booking, then the system rejects it.

*Current documented behavior:* reservations last 90 minutes; booking requests use
customer name, email, phone, party size, date, and time.

### US-03: Prevent Double Booking

> As a restaurant operator, I want the system to prevent overlapping reservations for a
> table, so that customers are not promised the same capacity twice.

**Acceptance criteria**

1. Given overlapping requests for the same table and time, when requests arrive
   concurrently, then no occupied table slot is assigned to more than one active
   reservation.
2. Given an unsuccessful booking attempt, when the system responds with a conflict, then
   no partial slot allocation remains for that attempt.
3. Given a table that cannot fit the party, when the system allocates a table, then that
   table is not selected.

*Current documented behavior:* a MongoDB unique index on `{ tableId, slotStart }`
protects 30-minute slot rows; the README describes an automated concurrency test.

### US-05: Staff Sign-In

> As a staff member, I want to sign in securely, so that only authorized staff can manage
> reservations.

**Proposed acceptance criteria:** confirm with Developer Lead and QA.

1. Valid staff credentials allow access to staff-only pages.
2. Invalid credentials do not grant access and return a safe error message.
3. Unauthenticated users cannot access protected staff endpoints.

### US-06: Staff Reservation Dashboard

> As a staff member, I want to view reservations by date and status, so that I can
> prepare for arriving customers.

**Proposed acceptance criteria:** confirm with team.

1. Authorized staff can view reservation reference, date/time, party size, assigned
   table, and status.
2. Staff can filter or otherwise find reservations for a selected date.
3. Customer contact information is visible only to authorized staff.

### US-07: Update Reservation Status

> As a staff member, I want to mark reservations as seated, completed, or no-show, so
> that the dashboard reflects restaurant operations.

**Proposed acceptance criteria:** confirm status transitions with team.

1. Authorized staff can perform allowed status changes.
2. Invalid status changes are rejected with a clear message.
3. Updated statuses are stored and shown consistently in the dashboard.

### US-08: Cancel a Reservation

> As a staff member, I want to cancel a reservation, so that the corresponding capacity
> can become available again.

**Proposed acceptance criteria:** confirm cancellation rules with team.

1. Authorized staff can cancel an eligible reservation.
2. Cancelling releases its occupied slots without affecting other reservations.
3. Repeated cancellation requests do not create inconsistent data.

## 5. Existing Technical Rules to Preserve

The README documents these Sprint 1 rules. Changes require agreement and regression
testing.

| Rule | Documented value |
| --- | --- |
| Restaurant timezone | America/Toronto (daylight-saving aware) |
| Service hours | 11:00 to 22:00 local |
| Booking start times | 11:00 to 20:30 every 30 minutes |
| Reservation duration | 90 minutes |
| Party size | 1 to 20 |
| Seeded tables | Six tables: capacities 2, 2, 4, 4, 6, 8 |
| Booking statuses | CONFIRMED, SEATED, COMPLETED, CANCELLED, NO_SHOW |
| Capacity-blocking statuses | CONFIRMED, SEATED |

> **Clarification needed:** A party size up to 20 is accepted by input validation, but
> the seeded tables have a maximum individual capacity of 8. The team should confirm
> whether parties larger than 8 should receive `NO_TABLE_AVAILABLE` or whether combining
> tables is planned. Do not assume table combining is supported.

## 6. Proposed Sprint Planning

| Sprint | Scope | Basis |
| --- | --- | --- |
| Sprint 1 | Customer availability, booking, table allocation, concurrency protection | Documented as implemented in README |
| Sprint 2 | Review usability, refine requirements, validate customer flow, address identified defects | Proposal; team approval required |
| Sprint 3 | Staff authentication, reservation management, seating, cancellation | Planned in README |
| Sprint 4 | End-to-end testing, UAT, documentation, demo preparation | Proposal; team approval required |

> **Note:** This is a planning suggestion, not a confirmed schedule. Agree on sprint
> dates, scope, and owners during team planning.

## 7. BA / PM Action Items

- [ ] Review this backlog with Tom and the QA team member.
- [ ] Confirm that backlog stories match the current PRD and implemented code.
- [ ] Confirm acceptance criteria for staff authentication, statuses, and cancellation.
- [ ] Clarify party-size policy for parties larger than the largest seeded table.
- [ ] Create GitHub Issues for agreed, outstanding stories; link each issue to its
      story ID.
- [ ] Agree on sprint dates, task ownership, and weekly reporting expectations.
- [ ] Update story status only after implementation and QA verification.

## 8. Change Control

Any change to scope or business rules should be recorded in a GitHub Issue or documented
team decision. The BA/PM assesses the requirement and priority, the Developer Lead
estimates technical impact, and QA identifies necessary tests. Approved changes are
scheduled into a sprint and reflected in this backlog and the PRD.
