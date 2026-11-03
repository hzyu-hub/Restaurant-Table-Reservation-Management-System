/**
 * The status transition matrix (audit 3.8, rec 2).
 *
 * US4 requires "invalid transitions are rejected", which was undefined until
 * the matrix existed. This file checks the matrix exhaustively over all 25
 * from/to pairs, so Sprint 3's endpoint has a contract to validate against
 * rather than a rule to invent.
 *
 * Data plus tests only: there is deliberately no staff endpoint here.
 */
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  BLOCKING_STATUSES,
  RESERVATION_STATUSES,
  holdsCapacity,
  isTransitionAllowed,
  type ReservationStatus,
} from '../src/config/booking.js';

/** The matrix exactly as agreed, written out independently of the source. */
const EXPECTED: Record<ReservationStatus, ReservationStatus[]> = {
  CONFIRMED: ['SEATED', 'CANCELLED', 'NO_SHOW'],
  SEATED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

describe('ALLOWED_TRANSITIONS', () => {
  it('covers every status in RESERVATION_STATUSES, and only those', () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual(
      [...RESERVATION_STATUSES].sort(),
    );
  });

  it('matches the agreed matrix for all 25 from/to pairs', () => {
    // One assertion per pair, named, so a failure says which edge moved.
    const failures: string[] = [];

    for (const from of RESERVATION_STATUSES) {
      for (const to of RESERVATION_STATUSES) {
        const expected = EXPECTED[from].includes(to);
        const actual = isTransitionAllowed(from, to);
        if (expected !== actual) {
          failures.push(`${from} -> ${to}: expected ${expected}, got ${actual}`);
        }
      }
    }

    expect(failures).toEqual([]);
    expect(RESERVATION_STATUSES.length ** 2).toBe(25);
  });

  it('allows exactly 4 edges out of 25', () => {
    const edges = RESERVATION_STATUSES.flatMap((from) =>
      ALLOWED_TRANSITIONS[from].map((to) => `${from}->${to}`),
    );
    expect(edges.sort()).toEqual(
      ['CONFIRMED->CANCELLED', 'CONFIRMED->NO_SHOW', 'CONFIRMED->SEATED', 'SEATED->COMPLETED'].sort(),
    );
  });

  it('treats COMPLETED, CANCELLED and NO_SHOW as terminal', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(ALLOWED_TRANSITIONS[terminal]).toEqual([]);
      for (const to of RESERVATION_STATUSES) {
        expect(isTransitionAllowed(terminal, to)).toBe(false);
      }
    }
  });

  it('never allows a self-transition', () => {
    for (const status of RESERVATION_STATUSES) {
      expect(isTransitionAllowed(status, status)).toBe(false);
    }
  });

  it('never allows a transition INTO CONFIRMED (it is only an initial state)', () => {
    for (const from of RESERVATION_STATUSES) {
      expect(isTransitionAllowed(from, 'CONFIRMED')).toBe(false);
    }
  });

  it('exactly one edge stays inside the blocking set, and it is CONFIRMED -> SEATED', () => {
    // NOTE ON THE INVARIANT. The audit's rec 2 asks for the rule "every
    // transition OUT of a blocking status leads to a non-blocking status".
    // The matrix it also asks for contains CONFIRMED -> SEATED, which is
    // blocking -> blocking. Those two requirements cannot both hold, so the
    // rule as stated is not the right invariant. The real one is stated in the
    // next test: release slot rows when the transition lands in a NON-blocking
    // status, and only then.
    //
    // CONFIRMED -> SEATED is exactly the "customer arrived, same table" move.
    // The table is still occupied, so releasing here would let the same table
    // be booked twice for the same evening. Pinning it to one known edge means
    // a future blocking -> blocking edge has to be argued for explicitly.
    const blockingToBlocking: string[] = [];

    for (const from of RESERVATION_STATUSES) {
      if (!holdsCapacity(from)) {
        continue;
      }
      for (const to of ALLOWED_TRANSITIONS[from]) {
        if (holdsCapacity(to)) {
          blockingToBlocking.push(`${from} -> ${to}`);
        }
      }
    }

    expect(blockingToBlocking).toEqual(['CONFIRMED -> SEATED']);
  });

  it('every edge INTO a non-blocking status from a blocking status is a release edge', () => {
    // This is what makes slot release correct: the set of transitions that must
    // call `releaseWindow` is derivable from `holdsCapacity(to)`, so Sprint 3's
    // handler never has to enumerate statuses by hand.
    const releaseEdges = RESERVATION_STATUSES.flatMap((from) =>
      ALLOWED_TRANSITIONS[from]
        .filter((to) => holdsCapacity(from) && !holdsCapacity(to))
        .map((to) => `${from}->${to}`),
    );

    expect(releaseEdges.sort()).toEqual(
      ['CONFIRMED->CANCELLED', 'CONFIRMED->NO_SHOW', 'SEATED->COMPLETED'].sort(),
    );

    // And the converse: no edge ever needs to CREATE slot rows, because
    // CONFIRMED is only an initial state and nothing transitions into it.
    const createEdges = RESERVATION_STATUSES.flatMap((from) =>
      ALLOWED_TRANSITIONS[from]
        .filter((to) => !holdsCapacity(from) && holdsCapacity(to))
        .map((to) => `${from}->${to}`),
    );
    expect(createEdges).toEqual([]);
  });

  it('every transition out of a terminal status would be a no-op for capacity', () => {
    // Terminal statuses are already non-blocking, so no release is needed if
    // one is ever added. Documents the reasoning rather than asserting an edge.
    for (const status of ['COMPLETED', 'CANCELLED', 'NO_SHOW'] as const) {
      expect(holdsCapacity(status)).toBe(false);
    }
  });
});

describe('holdsCapacity', () => {
  it('reads BLOCKING_STATUSES rather than re-listing statuses', () => {
    for (const status of RESERVATION_STATUSES) {
      expect(holdsCapacity(status)).toBe(
        (BLOCKING_STATUSES as readonly ReservationStatus[]).includes(status),
      );
    }
  });

  it('blocks for CONFIRMED and SEATED only', () => {
    const blocking = RESERVATION_STATUSES.filter((status) => holdsCapacity(status));
    expect(blocking.sort()).toEqual(['CONFIRMED', 'SEATED']);
  });
});
