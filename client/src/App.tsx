import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiRequestError,
  createReservation,
  fetchAvailability,
  fetchServerClock,
  type AvailabilitySlot,
  type ReservationResponse,
} from './api.ts';
import BookingForm, { type CustomerFormValues } from './components/BookingForm.tsx';
import Confirmation from './components/Confirmation.tsx';
import ErrorBanner from './components/ErrorBanner.tsx';
import SlotPicker from './components/SlotPicker.tsx';

/** Formats a start time in the restaurant's timezone for the summary line. */
function formatSlotLabel(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  }).format(new Date(isoInstant));
}

/**
 * The API wants the restaurant-local wall clock as `HH:mm`. Formatting in the
 * restaurant timezone (rather than the browser's) keeps the value correct even
 * when the customer books from another region.
 */
function toApiClockTime(isoInstant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(isoInstant));
}

interface BannerState {
  code: string;
  message: string;
}

/** Reads an unknown thrown value into a client-safe banner. */
function toBanner(error: unknown): BannerState {
  if (error instanceof ApiRequestError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'CLIENT_ERROR', message: error.message };
  }
  return {
    code: 'CLIENT_ERROR',
    message: 'Something unexpected happened. Please try again.',
  };
}

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const FALLBACK_TIMEZONE = 'America/Toronto';

export default function App() {
  /**
   * The default booking date and the input's `min` both come from the SERVER,
   * never from the browser clock.
   *
   * `null` until the bootstrap call returns, because guessing from
   * `new Date()` is exactly the bug: a customer in Hawaii at 8pm has a browser
   * date the restaurant already considers yesterday, so the first availability
   * request comes back `400 DATE_IN_PAST` before they touch anything.
   *
   * Bootstrap choice: `GET /api/health` is the cheapest call that always
   * succeeds and needs no parameters, so it carries `today` (and the timezone)
   * rather than the client firing a speculative availability request with a
   * guessed date and then correcting itself. One extra request on first load,
   * no wasted availability query, and no wrong-date error to swallow.
   */
  const [today, setToday] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [partySize, setPartySize] = useState<number>(2);
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [timeZone, setTimeZone] = useState<string>(FALLBACK_TIMEZONE);
  const [durationMinutes, setDurationMinutes] = useState<number>(90);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [reservation, setReservation] = useState<ReservationResponse | null>(null);

  /**
   * Loads slots for a date/party size.
   *
   * Deliberately leaves `banner` alone: a conflict refresh happens *after* the
   * error has been set, and clearing it here would erase the explanation the
   * customer needs. Callers decide when an error is stale.
   */
  const loadAvailability = useCallback(
    async (targetDate: string, targetPartySize: number): Promise<void> => {
      setLoading(true);
      try {
        const result = await fetchAvailability(targetDate, targetPartySize);
        setSlots(result.slots);
        setTimeZone(result.timezone);
        setDurationMinutes(result.durationMinutes);
        // Keep the `min` attribute honest across a midnight rollover while the
        // page stays open.
        setToday(result.today);
        setSelectedSlot((current) => {
          if (current === null) {
            return null;
          }
          const stillOpen = result.slots.find(
            (slot) => slot.startTime === current.startTime,
          );
          return stillOpen !== undefined && stillOpen.available ? stillOpen : null;
        });
      } catch (error: unknown) {
        setSlots([]);
        setSelectedSlot(null);
        setBanner(toBanner(error));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Bootstrap: learn the restaurant's today before asking for availability, so
  // the very first request cannot be for a date the server considers past.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const clock = await fetchServerClock();
        if (cancelled) {
          return;
        }
        setToday(clock.today);
        setTimeZone(clock.timezone);
        setDate((current) => current ?? clock.today);
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        setBanner(toBanner(error));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (date === null) {
      return;
    }
    setBanner(null);
    setSelectedSlot(null);
    void loadAvailability(date, partySize);
  }, [date, partySize, loadAvailability]);

  const selectedTimeLabel = useMemo(() => {
    if (selectedSlot === null) {
      return null;
    }
    return formatSlotLabel(selectedSlot.startTime, timeZone);
  }, [selectedSlot, timeZone]);

  const handleSubmit = async (values: CustomerFormValues): Promise<void> => {
    if (selectedSlot === null || date === null) {
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const created = await createReservation({
        customerName: values.customerName,
        customerEmail:
          values.customerEmail.length > 0 ? values.customerEmail : undefined,
        customerPhone: values.customerPhone,
        partySize,
        date,
        time: toApiClockTime(selectedSlot.startTime, timeZone),
      });
      setReservation(created);
    } catch (error: unknown) {
      setBanner(toBanner(error));
      // A conflict means someone took the slot: refresh so the UI tells the truth.
      if (error instanceof ApiRequestError && error.status === 409) {
        await loadAvailability(date, partySize);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleBookAnother = (): void => {
    setReservation(null);
    setSelectedSlot(null);
    if (date !== null) {
      void loadAvailability(date, partySize);
    }
  };

  if (reservation !== null) {
    return (
      <main className="page">
        <div className="card">
          <h1 className="brand">Table Reservations</h1>
          <Confirmation
            reservation={reservation}
            timeZone={timeZone}
            onBookAnother={handleBookAnother}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <header className="page-header">
          <h1 className="brand">Table Reservations</h1>
          <p className="subtitle">
            Open daily 11:00&nbsp;AM – 10:00&nbsp;PM. Bookings last{' '}
            {durationMinutes} minutes.
          </p>
        </header>

        {banner !== null && (
          <ErrorBanner
            code={banner.code}
            message={banner.message}
            onDismiss={() => {
              setBanner(null);
            }}
          />
        )}

        <section className="controls">
          <label className="field">
            <span className="field__label">Date</span>
            <input
              type="date"
              name="date"
              value={date ?? ''}
              // Same server-provided value as the default, so the picker can
              // never offer a date the API would reject.
              min={today ?? undefined}
              disabled={date === null}
              onChange={(event) => {
                setDate(event.target.value);
                setSelectedSlot(null);
              }}
            />
          </label>

          <label className="field">
            <span className="field__label">Party size</span>
            <select
              name="partySize"
              value={partySize}
              onChange={(event) => {
                setPartySize(Number(event.target.value));
                setSelectedSlot(null);
              }}
            >
              {PARTY_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} {size === 1 ? 'guest' : 'guests'}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="availability">
          <h2>Pick a time</h2>
          {loading || date === null ? (
            <p className="slots-empty" role="status">
              Loading available times…
            </p>
          ) : (
            <SlotPicker
              slots={slots}
              timeZone={timeZone}
              selectedStartTime={selectedSlot?.startTime ?? null}
              disabled={submitting}
              onSelect={(slot) => {
                setSelectedSlot(slot);
                setBanner(null);
              }}
            />
          )}
        </section>

        <BookingForm
          selectedTimeLabel={selectedTimeLabel}
          partySize={partySize}
          submitting={submitting}
          onSubmit={(values) => {
            void handleSubmit(values);
          }}
        />
      </div>
    </main>
  );
}
